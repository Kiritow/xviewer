import koaRouter from "koa-router";
import z from "zod";
import { dao } from "./common";
import getOrCreateLogger from "./base-log";
import { ESSimpleSearch, GetHeatFromInfo } from "./utils";
import { getCurrentUser } from "session";

const CDN_PREFIX = process.env.CDN_PREFIX;

const router = new koaRouter({
    prefix: "/api",
});

export default router;

const logger = getOrCreateLogger("app", { level: "debug" });

router.get("/list", async (ctx) => {
    const videos = await dao.getVideoObjects();
    const videoMap = new Map(videos.map((row) => [row.id, row]));

    const videoStats = await dao.getVideoWatchStat();

    const videoProgressRatioMap = new Map(
        videoStats
            .map((stat) => {
                const info = videoMap.get(stat.id);
                if (info !== undefined) {
                    return {
                        ...stat,
                        progress: stat.avgtime / info?.videotime,
                    };
                }
            })
            .filter((stat) => stat !== undefined)
            .sort((a, b) => a.progress - b.progress)
            .map((stat, idx, arr) => {
                return [stat.id, 1 + (idx + 1) / arr.length];
            })
    );

    let sumHeat = 0;
    let countHeat = 0;
    let avgHeat = 0;
    videos.forEach((info) => {
        const heat = GetHeatFromInfo(
            info,
            videoProgressRatioMap.get(info.id) || 1
        );
        info.watchcount = heat;
        if (heat > 0) {
            sumHeat += heat;
            countHeat += 1;
        }
    });
    if (countHeat > 0) {
        avgHeat = sumHeat / countHeat;
        videos.forEach((info) => {
            info.watchcount = (info.watchcount * 100) / avgHeat;
        });
    }

    const videoTranscodeTasks = await dao.getVideoTranscodeTasks();
    const videoTranscodeTasksIndex = new Map(
        videoTranscodeTasks.map((row) => [row.id, row])
    );

    const videoWithTranscode = videos.map((info) => {
        const task = videoTranscodeTasksIndex.get(info.id);
        return {
            ...info,
            transcode: task?.id,
        };
    });

    ctx.body = {
        videos: videoWithTranscode,
        cdn: CDN_PREFIX,
    };
});

router.get("/search", async (ctx) => {
    const query = z
        .object({
            kw: z.string(),
        })
        .safeParse(ctx.query);
    if (!query.success) {
        ctx.status = 400;
        return;
    }
    const { kw } = query.data;

    const response = await ESSimpleSearch(kw, 10000);
    const result = response
        .map((data) => data._source?.vid)
        .filter((vid) => vid !== undefined);

    ctx.body = [...new Set(result)];
});

router.get("/recommend", async (ctx) => {
    const query = z
        .object({
            from: z.string(),
        })
        .safeParse(ctx.query);
    if (!query.success) {
        ctx.status = 400;
        return;
    }
    const { from: fromId } = query.data;

    const info = await dao.getSingleVideoObject(fromId);
    if (!info) {
        ctx.body = [];
        return;
    }

    const response = await ESSimpleSearch(info.filename, 10);
    const result = response
        .map((data) => data._source?.vid)
        .filter((vid) => vid !== undefined);

    ctx.body = [...new Set(result)];
});

router.post("/preferred", async (ctx) => {
    const user = getCurrentUser(ctx);
    if (user === undefined) {
        ctx.body = {
            code: 0,
            message: "success",
            data: {
                videos: [],
            },
        };
        return;
    }

    const favVideoIds = await dao.getFavByUserId(user.oldUid);
    const history = await dao.getHistoryByUserId(user.oldUid);

    const tempSet = new Set<string>();
    for (let i = 0; i < 8; i++) {
        if (favVideoIds.length > 0) {
            tempSet.add(
                favVideoIds[Math.floor(Math.random() * favVideoIds.length)]
            );
        }
    }

    for (let i = 0; i < 4; i++) {
        if (history.length > 0) {
            tempSet.add(history[Math.floor(Math.random() * history.length)].id);
        }
    }

    if (tempSet.size < 1) {
        ctx.body = {
            code: 0,
            message: "success",
            data: {
                videos: [],
            },
        };
        return;
    }

    const infoArr = (
        await Promise.all(
            Array.from(tempSet).map((id) => dao.getSingleVideoObject(id))
        )
    ).filter((info) => info !== null);

    const finalSet = new Set<string>();
    const sourceShowRate = 30;
    const esSearchResults = await Promise.all(
        infoArr.map((info) => ESSimpleSearch(info.filename, 10))
    );
    esSearchResults.forEach((response) => {
        const result = response
            .map((data) => data._source?.vid)
            .filter((vid) => vid !== undefined);

        result.forEach((vid) => {
            if (!tempSet.has(vid)) {
                finalSet.add(vid);
            } else if (Math.random() * 100 >= sourceShowRate) {
                finalSet.add(vid);
            }
        });
    });

    ctx.body = {
        code: 0,
        message: "success",
        data: {
            videos: Array.from(finalSet),
        },
    };
});

router.post("/video_played", async (ctx) => {
    const remoteIP =
        ctx.headers["x-forwarded-for"] ||
        ctx.headers["x-real-ip"] ||
        ctx.request.ip;
    logger.info(remoteIP);
    let useRemoteIP = "";
    if (remoteIP instanceof Array) {
        useRemoteIP = remoteIP.join(",");
    } else {
        useRemoteIP = remoteIP;
    }

    const user = getCurrentUser(ctx);

    const body = z
        .object({
            id: z.string(),
            transcode: z.boolean(),
        })
        .parse(ctx.request.body);
    if (!body) {
        ctx.status = 400;
        return;
    }

    const { id: videoID, transcode: isTranscode } = body;

    logger.info(`AddVideoCount: ${remoteIP} ${videoID} ${user?.username}`);

    await dao.addVideoWatchByID(videoID, isTranscode);
    const insertId = await dao.addVideoWatchHistory(
        user?.oldUid || "",
        useRemoteIP,
        videoID
    );
    ctx.body = {
        code: 0,
        message: "success",
        data: {
            playid: insertId,
        },
    };
});

router.post("/video_playing", async (ctx) => {
    const body = z
        .object({
            playid: z.number(),
            duration: z.number(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }

    const { playid, duration } = body.data;

    await dao.updateVideoWatchHistory(playid, duration);
    ctx.body = {
        code: 0,
        message: "success",
    };
});

router.post("/add_tag", async (ctx) => {
    const body = z
        .object({
            id: z.string(),
            tag: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID, tag: tagValue } = body.data;

    logger.info(`AddTag: video=${videoID} tag=${tagValue}`);
    await dao.addVideoTag(videoID, tagValue);

    ctx.body = "OK";
});

router.post("/remove_tag", async (ctx) => {
    const body = z
        .object({
            id: z.string(),
            tag: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID, tag: tagValue } = body.data;

    logger.info(`RemoveTag: video=${videoID} tag=${tagValue}`);
    await dao.removeVideoTag(videoID, tagValue);

    ctx.body = "OK";
});

router.post("/add_fav", async (ctx) => {
    const user = getCurrentUser(ctx);
    if (user === undefined) {
        ctx.body = "OK";
        return;
    }

    const body = z
        .object({
            id: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID } = body.data;

    logger.info(`AddUserFav: video=${videoID} user=${user.username}`);
    await dao.addVideoFav(user.oldUid, videoID);

    ctx.body = "OK";
});

router.post("/remove_fav", async (ctx) => {
    const user = getCurrentUser(ctx);
    if (user === undefined) {
        ctx.body = "OK";
        return;
    }

    const body = z
        .object({
            id: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID } = body.data;

    logger.info(`RemoveUserFav: video=${videoID} user=${user.username}`);
    await dao.removeVideoFav(user.oldUid, videoID);

    ctx.body = "OK";
});

router.post("/thumbs_up", async (ctx) => {
    const body = z
        .object({
            id: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID } = body.data;

    logger.info(`ThumbsUp: video=${videoID}`);
    await dao.voteVideo(videoID, 1);

    ctx.body = "OK";
});

router.post("/thumbs_down", async (ctx) => {
    const body = z
        .object({
            id: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID } = body.data;

    logger.info(`ThumbsUp: video=${videoID}`);
    await dao.voteVideo(videoID, -1);

    ctx.body = "OK";
});

router.post("/start_encode", async (ctx) => {
    const body = z
        .object({
            id: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID } = body.data;

    logger.info(`StartEncode: video=${videoID}`);
    await dao.addTranscodeTask(videoID);

    ctx.body = "OK";
});

router.post("/favorites", async (ctx) => {
    const user = getCurrentUser(ctx);
    if (user === undefined) {
        ctx.body = [];
        return;
    }

    ctx.body = await dao.getFavByUserId(user.oldUid);
});

router.post("/history", async (ctx) => {
    const user = getCurrentUser(ctx);
    if (user === undefined) {
        ctx.body = [];
        return;
    }

    ctx.body = await dao.getHistoryByUserId(user.oldUid);
});

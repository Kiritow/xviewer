import koaRouter from "koa-router";
import z from "zod";
import { dao } from "./common";
import getOrCreateLogger from "./base-log";
import { ESSimpleSearch, GetHeatFromInfo } from "./utils";

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
    const body = z
        .object({
            ticket: z.string().optional(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { ticket } = body.data;

    if (ticket === undefined || ticket.length < 1) {
        ctx.body = {
            code: 0,
            message: "success",
            data: {
                videos: [],
            },
        };
        return;
    }

    const favVideoIds = await dao.getFavByTicket(ticket);
    const history = await dao.getHistoryByTicket(ticket);

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

    const body = z
        .object({
            id: z.string(),
            transcode: z.boolean(),
            ticket: z.string().optional(),
        })
        .parse(ctx.request.body);
    if (!body) {
        ctx.status = 400;
        return;
    }

    const { id: videoID, transcode: isTranscode, ticket } = body;

    logger.info(`AddVideoCount: ${remoteIP} ${videoID} ${ticket}`);

    await dao.addVideoWatchByID(videoID, isTranscode);
    const insertId = await dao.addVideoWatchHistory(
        ticket ?? "",
        useRemoteIP,
        videoID
    );
    ctx.body = {
        code: 0,
        message: "success",
        data: {
            sess: insertId,
        },
    };
});

router.post("/video_playing", async (ctx) => {
    const body = z
        .object({
            sess: z.number(),
            duration: z.number(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }

    const { sess, duration } = body.data;

    await dao.updateVideoWatchHistory(sess, duration);
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
    const body = z
        .object({
            id: z.string(),
            ticket: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID, ticket } = body.data;

    logger.info(`AddUserFav: video=${videoID} user=${ticket}`);
    await dao.addVideoFav(ticket, videoID);

    ctx.body = "OK";
});

router.post("/remove_fav", async (ctx) => {
    const body = z
        .object({
            id: z.string(),
            ticket: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { id: videoID, ticket } = body.data;

    logger.info(`RemoveUserFav: video=${videoID} user=${ticket}`);
    await dao.removeVideoFav(ticket, videoID);

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
    const body = z
        .object({
            ticket: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { ticket } = body.data;

    ctx.body = await dao.getFavByTicket(ticket);
});

router.post("/history", async (ctx) => {
    const body = z
        .object({
            ticket: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { ticket } = body.data;

    ctx.body = await dao.getHistoryByTicket(ticket);
});

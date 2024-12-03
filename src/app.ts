import fs from "fs";
import path from "path";
import koa from "koa";
import koaRouter from "koa-router";
import koaBodyParser from "koa-bodyparser";
import koaJson from "koa-json";
import { Client as ESClient } from "@elastic/elasticsearch";
import { DaoClass } from "./dao";
import getOrCreateLogger from "./base-log";
import { VideoObjectInfo } from "./models";
import { NewAsyncRootMW } from "./mws";
import { z } from "zod";
import { SearchResponse } from "@elastic/elasticsearch/api/types";

const logger = getOrCreateLogger("app", { level: "debug" });

const ROOT_DIR = process.env.ROOT_DIR || "/data";
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "80", 10);
const CDN_PREFIX = process.env.CDN_PREFIX;
const ES_HOST = process.env.ES_HOST;
const ES_PORT = parseInt(process.env.ES_PORT || "9200", 10);
const ES_INDEX = process.env.ES_INDEX;
const XVIEWER_VERSION = JSON.parse(
    fs.readFileSync("package.json", "utf-8")
).version;
const db = new DaoClass({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
});

const esClient = new ESClient({
    node: `http://${ES_HOST}:${ES_PORT}`,
});

const app = new koa();
app.use(koaBodyParser());
app.use(koaJson());
app.use(NewAsyncRootMW(true));

const router = new koaRouter();

function GetHeatFromInfo(info: VideoObjectInfo, progressRatio: number) {
    const now = Date.now();

    let heat = 0;
    if (now - info.createtime.getTime() < 1000 * 60 * 60 * 24 * 30) {
        heat += 200;
    } else if (now - info.createtime.getTime() < 1000 * 60 * 60 * 24 * 90) {
        heat += 150;
    } else if (now - info.createtime.getTime() < 1000 * 60 * 60 * 24 * 180) {
        heat += 100;
    } else if (now - info.createtime.getTime() < 1000 * 60 * 60 * 24 * 365) {
        heat += 50;
    }

    if (info.watchcount < 1) {
        heat -= 190;
    } else if (info.watchcount < 5) {
        heat += 15 * info.watchcount * progressRatio;
    } else if (info.watchcount < 10) {
        heat += (65 + (info.watchcount - 5) * 35) * progressRatio;
    } else if (info.watchcount < 100) {
        heat += (240 + (info.watchcount - 10) * 30) * progressRatio;
    } else {
        heat += (2940 + (info.watchcount - 100) * 10) * progressRatio;
    }

    return heat;
}

router.get("/api/list", async (ctx) => {
    const videos = await db.getVideoObjects();
    const videoMap = new Map(videos.map((row) => [row.id, row]));

    const videoStats = await db.getVideoWatchStat();

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

    const videoTranscodeTasks = await db.getVideoTranscodeTasks();
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

function isObjectExists(objectId: string) {
    const prefix = objectId.substring(0, 2);
    const resourcePath = `${prefix}/${objectId}`;
    const filePath = path.join(ROOT_DIR, "objects", resourcePath);

    return new Promise((resolve) => {
        fs.access(filePath, fs.constants.R_OK, (err) =>
            resolve(err ? false : true)
        );
    });
}

interface ESDataType {
    name: string;
    vid: string;
}

async function ESSimpleSearch(keyword: string, size: number) {
    const result = await esClient.search<SearchResponse<ESDataType>>({
        index: ES_INDEX,
        size,
        body: {
            query: {
                match: {
                    name: keyword,
                },
            },
        },
    });

    logger.debug(result.body);
    return result.body.hits.hits;
}

router.get("/api/search", async (ctx) => {
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

router.get("/api/recommend", async (ctx) => {
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

    const info = await db.getSingleVideoObject(fromId);
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

router.post("/api/preferred", async (ctx) => {
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

    const favVideoIds = await db.getFavByTicket(ticket);
    const history = await db.getHistoryByTicket(ticket);

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
            Array.from(tempSet).map((id) => db.getSingleVideoObject(id))
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

router.post("/api/video_played", async (ctx) => {
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

    await db.addVideoWatchByID(videoID, isTranscode);
    const insertId = await db.addVideoWatchHistory(
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

router.post("/api/video_playing", async (ctx) => {
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

    await db.updateVideoWatchHistory(sess, duration);
    ctx.body = {
        code: 0,
        message: "success",
    };
});

router.post("/api/add_tag", async (ctx) => {
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
    await db.addVideoTag(videoID, tagValue);

    ctx.body = "OK";
});

router.post("/api/remove_tag", async (ctx) => {
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
    await db.removeVideoTag(videoID, tagValue);

    ctx.body = "OK";
});

router.post("/api/add_fav", async (ctx) => {
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
    await db.addVideoFav(ticket, videoID);

    ctx.body = "OK";
});

router.post("/api/remove_fav", async (ctx) => {
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
    await db.removeVideoFav(ticket, videoID);

    ctx.body = "OK";
});

router.post("/api/thumbs_up", async (ctx) => {
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
    await db.voteVideo(videoID, 1);

    ctx.body = "OK";
});

router.post("/api/thumbs_down", async (ctx) => {
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
    await db.voteVideo(videoID, -1);

    ctx.body = "OK";
});

router.post("/api/start_encode", async (ctx) => {
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
    await db.addTranscodeTask(videoID);

    ctx.body = "OK";
});

router.post("/api/favorites", async (ctx) => {
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

    ctx.body = await db.getFavByTicket(ticket);
});

router.post("/api/history", async (ctx) => {
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

    ctx.body = await db.getHistoryByTicket(ticket);
});

router.post("/api/login", async (ctx) => {
    const body = z
        .object({
            username: z.string(),
            password: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { username, password: passhash } = body.data;

    const user = await db.getValidUser(username, passhash);
    if (user === null) {
        ctx.status = 403;
        ctx.body = "login failed, invalid username or password";
        return;
    }

    const ticket = await db.createTicket(user.uid, 12 * 3600 * 1000);
    ctx.body = {
        code: 0,
        message: "success",
        username: user.username,
        uid: user.uid,
        ticket,
    };
});

router.post("/api/register", async (ctx) => {
    const body = z
        .object({
            username: z.string(),
            password: z.string(),
        })
        .safeParse(ctx.request.body);
    if (!body.success) {
        ctx.status = 400;
        return;
    }
    const { username, password: passhash } = body.data;

    const newUserId = await db.addUser(username, passhash);
    const ticket = await db.createTicket(newUserId, 12 * 3600 * 1000);
    ctx.body = {
        code: 0,
        message: "success",
        uid: newUserId,
        username,
        ticket,
    };
});

app.use(router.routes()).use(router.allowedMethods());

async function PreReadObjectList() {
    const objLst = await db.getAllObjectID();
    let cntFailed = 0;
    await Promise.all(
        objLst.map(async (objId) => {
            if (!(await isObjectExists(objId))) {
                ++cntFailed;
                logger.info(`[WARN] object ${objId} not found on disk`);
            }
        })
    );

    logger.warn(
        `${objLst.length} objects checked. ${cntFailed} objects not found.`
    );
}

async function main() {
    logger.info(`Backend version: ${XVIEWER_VERSION}`);
    logger.info("Object list pre-reading...");
    await PreReadObjectList();
    logger.info("Starting web server...");
    app.listen(LISTEN_PORT);
}

const serverStartTime = new Date().getTime();
main()
    .then(() => {
        logger.info(
            `Server started in ${(new Date().getTime() - serverStartTime) / 1000}s.`
        );
    })
    .catch((err) => {
        logger.error(`[Fatal] Exception caught: ${err}`);
    });

import koaRouter from "koa-router";
import z from "zod";
import { dao, esClient } from "./common";
import getOrCreateLogger from "./base-log";
import { GetHeatFromInfo } from "./utils";
import { GetESIndex, GetRootPath } from "./configs";
import { getCurrentUser } from "./session";
import { VideoManager } from "./video_manager";

const router = new koaRouter({
    prefix: "/api/admin",
});

export default router;

router.post("/build_index", async (ctx) => {
    const user = getCurrentUser(ctx);
    if (user === undefined) {
        ctx.status = 403;
        ctx.body = "not login";
        return;
    }

    // TODO: add permission check

    const videos = await dao.getVideoObjects();
    try {
        await esClient.indices.delete({
            index: GetESIndex(),
        });
    } catch (e) {
        console.log(e);
        console.log(`delete index ${GetESIndex()} failed, ignore`);
    }

    try {
        await esClient.indices.create(
            {
                index: GetESIndex(),
            },
            {
                ignore: [400],
            }
        );
    } catch (e) {
        console.log(e);
        console.log(`create index ${GetESIndex()} failed, ignore`);
    }

    const dataset = videos.map((v) => ({
        name: v.filename,
        vid: v.id,
    }));
    const operations = dataset.flatMap((doc) => [
        { index: { _index: GetESIndex() } },
        doc,
    ]);

    await esClient.bulk({ refresh: true, body: operations });

    const count = await esClient.count({ index: GetESIndex() });
    ctx.body = {
        message: `success, ${count.body.count} records inserted`,
    };
});

const rescanStatus = {
    isRunning: false,
    startTime: new Date(),
    finishTime: new Date(),
    lastError: "not started",
};

router.post("/rescan", async (ctx) => {
    const user = getCurrentUser(ctx);
    if (user === undefined) {
        ctx.status = 403;
        ctx.body = "not login";
        return;
    }

    // TODO: add permission check

    if (rescanStatus.isRunning) {
        ctx.body = {
            message: `rescan has already been started at ${rescanStatus.startTime}`,
        };
        return;
    }

    rescanStatus.isRunning = true;
    rescanStatus.startTime = new Date();
    rescanStatus.lastError = "started.";

    const rootPath = GetRootPath();

    const manager = new VideoManager(
        `${rootPath}/temp`,
        `${rootPath}/objects`,
        `${rootPath}/pending`
    );

    const reporter = (message: string) => {
        console.log(message);
        rescanStatus.lastError = `${rescanStatus.lastError}\n${message}`;
    };

    (async () => {
        try {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await manager.init();
            await manager.scan(reporter);
            reporter("success");
        } catch (e) {
            reporter(e instanceof Error ? e.message : `${e}`);
        } finally {
            rescanStatus.isRunning = false;
            rescanStatus.finishTime = new Date();
        }
    })();

    ctx.body = {
        message: `rescan started at ${rescanStatus.startTime}`,
    };
});

router.get("/rescan/status", async (ctx) => {
    ctx.body = {
        status: rescanStatus,
    };
});

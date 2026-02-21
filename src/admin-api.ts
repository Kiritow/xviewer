import koaRouter from "koa-router";
import z from "zod";
import { dao, esClient } from "./common";
import { GetAppConfig } from "./configs";
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

    const indexName = GetAppConfig().es.index;

    const videos = await dao.getVideoObjects();
    try {
        await esClient.indices.delete({
            index: indexName,
        });
    } catch (e) {
        console.log(e);
        console.log(`delete index ${indexName} failed, ignore`);
    }

    try {
        await esClient.indices.create(
            {
                index: indexName,
            },
            {
                ignore: [400],
            }
        );
    } catch (e) {
        console.log(e);
        console.log(`create index ${indexName} failed, ignore`);
    }

    const dataset = videos.map((v) => ({
        name: v.filename,
        vid: v.id,
    }));
    const operations = dataset.flatMap((doc) => [
        { index: { _index: indexName } },
        doc,
    ]);

    await esClient.bulk({ refresh: true, body: operations });

    const count = await esClient.count({ index: indexName });
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

    const reporter = (message: string) => {
        console.log(message);
        rescanStatus.lastError = `${rescanStatus.lastError}\n${message}`;
    };

    (async () => {
        for (const rootPathConfig of GetAppConfig().rootDirs) {
            const manager = new VideoManager(
                `${rootPathConfig.path}/temp`,
                `${rootPathConfig.path}/objects`,
                `${rootPathConfig.path}/pending`
            );

            await new Promise((resolve) => setTimeout(resolve, 3000));
            reporter(`started scan for ${rootPathConfig.path}`);
            await manager.scan(reporter);
            reporter(`finished scan for ${rootPathConfig.path}`);
        }
    })()
        .catch((e) => {
            reporter(
                `Failed to rescan: ${e instanceof Error ? e.message : `${e}`}`
            );
        })
        .finally(() => {
            rescanStatus.isRunning = false;
            rescanStatus.finishTime = new Date();
        });

    ctx.body = {
        message: `rescan started at ${rescanStatus.startTime}`,
    };
});

router.get("/rescan/status", async (ctx) => {
    ctx.body = {
        status: rescanStatus,
    };
});

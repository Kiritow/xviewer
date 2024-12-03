import "source-map-support/register";
import fs from "fs";
import koa from "koa";
import koaBodyParser from "koa-bodyparser";
import koaJson from "koa-json";
import { NewAsyncRootMW } from "./mws";
import apiRouter from "./api";
import authRouter from "./auth-api";
import { PreReadObjectList } from "./utils";
import getOrCreateLogger from "./base-log";

const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || "80", 10);
const XVIEWER_VERSION = JSON.parse(
    fs.readFileSync("package.json", "utf-8")
).version;

const app = new koa();
app.use(koaBodyParser());
app.use(koaJson());
app.use(NewAsyncRootMW(true));
app.use(authRouter.routes()).use(authRouter.allowedMethods());
app.use(apiRouter.routes()).use(apiRouter.allowedMethods());

const logger = getOrCreateLogger("main", { level: "debug" });

(async () => {
    const startTime = Date.now();

    logger.info(`Backend version: ${XVIEWER_VERSION}`);
    logger.info("Object list pre-reading...");
    await PreReadObjectList();
    logger.info("Starting web server...");
    app.listen(LISTEN_PORT);
    logger.info(`Server started in ${(Date.now() - startTime) / 1000}s.`);
})();

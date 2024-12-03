import Application, { Context, Middleware } from "koa";
import getOrCreateLogger from "./base-log";

const logger = getOrCreateLogger("mws");

export class ResponseAsError extends Error {
    statusCode: number;
    statusMessage: string;

    constructor(code: number, message: string) {
        super(`[${code}] ${message}`);
        this.name = "ResponseAsError";
        this.statusCode = code;
        this.statusMessage = message;
    }
}

export function NewAsyncRootMW(showDebug?: boolean): Middleware {
    return async (ctx: Context, next: Application.Next) => {
        const startTime = new Date();

        try {
            logger.info(`${ctx.method} ${ctx.URL}`);
            logger.info(ctx.headers);

            await next();
        } catch (e) {
            if (e instanceof ResponseAsError) {
                ctx.status = e.statusCode;
                ctx.body = e.statusMessage;
            } else {
                logger.error(e);

                ctx.status = 500;
                if (showDebug === true) {
                    ctx.body = `server internal error: ${e instanceof Error ? e.message : e}`;
                } else {
                    ctx.body = "server internal error";
                }
            }
        }

        logger.info(
            `${ctx.method} ${ctx.URL} [${ctx.status}] (${new Date().getTime() - startTime.getTime()}ms)`
        );
    };
}

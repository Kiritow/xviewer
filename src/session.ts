import koa from "koa";
import z from "zod";
import getOrCreateLogger from "./base-log";

const logger = getOrCreateLogger("session");

export interface UserSession {
    oldUid: string;
    userId: number;
    username: string;
}

export function getCurrentUser(
    ctx: koa.ParameterizedContext
): UserSession | undefined {
    if (ctx.session?.user === undefined) {
        return undefined;
    }

    const parsedSession = z
        .object({
            oldUid: z.string(),
            userId: z.number(),
            username: z.string(),
        })
        .safeParse(ctx.session?.user);

    if (!parsedSession.success) {
        logger.warn(
            `invalid user session, parse failed: ${parsedSession.error.message}`
        );
        return undefined;
    }

    return parsedSession.data;
}

export function setCurrentUser(
    ctx: koa.ParameterizedContext,
    user: UserSession
) {
    ctx.session!.user = user;
}

export function clearCurrentUser(ctx: koa.ParameterizedContext) {
    ctx.session = null;
}

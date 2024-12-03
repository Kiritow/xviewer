import z from "zod";
import koaRouter from "koa-router";
import { dao } from "./common";
import { clearCurrentUser, getCurrentUser, setCurrentUser } from "./session";

const router = new koaRouter({
    prefix: "/auth",
});
export default router;

router.get("/user", (ctx) => {
    const user = getCurrentUser(ctx);
    if (user === undefined) {
        ctx.status = 403;
        ctx.body = "not login";
        return;
    }

    ctx.body = {
        username: user.username,
        uid: user.oldUid,
    };
});

router.get("/logout", (ctx) => {
    clearCurrentUser(ctx);

    ctx.body = {
        message: "success",
    };
});

router.post("/login", async (ctx) => {
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
    const { username, password } = body.data;

    const user = await dao.getValidUser(username, password);
    if (user === null) {
        ctx.status = 403;
        ctx.body = "login failed, invalid username or password";
        return;
    }

    setCurrentUser(ctx, {
        oldUid: user.uid,
        userId: 0,
        username: user.username,
    });

    ctx.body = {
        code: 0,
        message: "success",
        username: user.username,
        uid: user.uid,
    };
});

router.post("/register", async (ctx) => {
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
    const { username, password } = body.data;
    if (username.length < 1 || password.length < 1) {
        ctx.status = 400;
        ctx.body = "invalid username or password";
        return;
    }

    const newUserId = await dao.addUser(username, password);
    setCurrentUser(ctx, {
        oldUid: newUserId,
        userId: 0,
        username,
    });

    ctx.body = {
        code: 0,
        message: "success",
        uid: newUserId,
        username,
    };
});

import z from "zod";
import koaRouter from "koa-router";
import { dao } from "./common";

const router = new koaRouter({
    prefix: "/auth",
});
export default router;

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
    const { username, password: passhash } = body.data;

    const user = await dao.getValidUser(username, passhash);
    if (user === null) {
        ctx.status = 403;
        ctx.body = "login failed, invalid username or password";
        return;
    }

    const ticket = await dao.createTicket(user.uid, 12 * 3600 * 1000);
    ctx.body = {
        code: 0,
        message: "success",
        username: user.username,
        uid: user.uid,
        ticket,
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
    const { username, password: passhash } = body.data;

    const newUserId = await dao.addUser(username, passhash);
    const ticket = await dao.createTicket(newUserId, 12 * 3600 * 1000);
    ctx.body = {
        code: 0,
        message: "success",
        uid: newUserId,
        username,
        ticket,
    };
});

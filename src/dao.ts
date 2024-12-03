import crypto from "crypto";
import { BaseDaoClass } from "./base-dao";
import {
    ObjectInfo,
    VideoObjectInfo,
    VideoTranscodeInfo,
    VideoWatchStat,
} from "./models";
import { z } from "zod";

function GetSha256(content: string) {
    return crypto.createHash("sha256").update(content).digest("hex");
}

function GenerateRandomSalt(): string {
    return crypto.randomBytes(16).toString("base64url").substring(11);
}

export class DaoClass extends BaseDaoClass {
    // If objID not in objects, {id:undefined} will be resolved.
    async getObject(objID: string) {
        const results = await this.query("select * from objects where id=?", [
            objID,
        ]);
        if (results.length < 1) {
            return null;
        }

        return ObjectInfo.parse(results[0]);
    }

    async getAllObjectID(): Promise<string[]> {
        const results = await this.query("select id from objects", []);
        return results.map((row) => {
            return row.id;
        });
    }

    async getSingleVideoObject(videoId: string) {
        const results = await this.query(
            "select videos.id,coverid,filename,mtime,fsize,videotime,watchcount,videos.createtime,videos.updatetime,tags from videos inner join objects on videos.id=objects.id where videos.id=?",
            [videoId]
        );
        if (results.length < 1) {
            return null;
        }

        return VideoObjectInfo.parse(results[0]);
    }

    async getVideoObjects() {
        const results = await this.query(
            "select videos.id,coverid,filename,mtime,fsize,videotime,watchcount,vote,videos.createtime,videos.updatetime,tags from videos inner join objects on videos.id=objects.id ",
            []
        );
        return results.map((row) => VideoObjectInfo.parse(row));
    }

    async getVideoWatchStat() {
        const results = await this.query(
            `
            select id, sum(watchtime) as totaltime, avg(watchtime) as avgtime
            from history where watchtime!=0 group by id`,
            []
        );
        return results.map((row) => VideoWatchStat.parse(row));
    }

    async getVideoTranscodeTasks() {
        const results = await this.query(
            `select * from transcode where encname!=''`,
            []
        );
        return results.map((row) => VideoTranscodeInfo.parse(row));
    }

    async addVideoWatchByID(objID: string, isTranscode: boolean) {
        await this.query(
            "update videos set watchcount=watchcount+1 where id=?",
            [objID]
        );
        if (isTranscode) {
            await this.query(
                "update transcode set watchcount=watchcount+1 where id=?",
                [objID]
            );
        }
    }

    async addVideoWatchHistory(
        ticket: string,
        remoteIP: string,
        objID: string
    ) {
        const uid = await this.getUserIDByTicket(ticket);

        const result = await this.run(
            "insert into history(username, host, id) values (?,?,?)",
            [uid ?? "", remoteIP, objID]
        );
        return result.insertId;
    }

    async updateVideoWatchHistory(watchId: number, duration: number) {
        await this.run("update history set watchtime=? where watchid=?", [
            duration,
            watchId,
        ]);
    }

    async voteVideo(objID: string, vote: number) {
        await this.run("update videos set vote=vote+? where id=?", [
            vote,
            objID,
        ]);
    }

    async addTranscodeTask(objID: string) {
        await this.run(
            "insert into transcode(id) values (?) on duplicate key update encname=?",
            [objID, ""]
        );
    }

    async addVideoTag(objID: string, value: string) {
        let conn = null;
        try {
            conn = await this.getConnection();
            await conn.begin();
            const result = await conn.query(
                "select * from videos where id=? for update",
                [objID]
            );
            if (result.length < 1) {
                return;
            }
            const data = result[0];
            const oldTags = JSON.parse(data.tags || "[]");
            if (oldTags.indexOf(value) == -1) {
                oldTags.push(value);
                await conn.query(
                    "update videos set tags=?, updatetime=updatetime where id=?",
                    [JSON.stringify(oldTags), objID]
                );
                await conn.commit();
            }
        } finally {
            if (conn) {
                await conn.rollback();
                conn.release();
            }
        }
    }

    async removeVideoTag(objID: string, value: string) {
        const conn = await this.getConnection();
        try {
            await conn.begin();
            const result = await conn.query(
                "select * from videos where id=? for update",
                [objID]
            );
            if (result.length < 1) {
                return;
            }
            const data = result[0];
            const oldTags = JSON.parse(data.tags || "[]");
            if (oldTags.indexOf(value) != -1) {
                oldTags.splice(oldTags.indexOf(value), 1);
                await conn.query(
                    "update videos set tags=?, updatetime=updatetime where id=?",
                    [JSON.stringify(oldTags), objID]
                );
                await conn.commit();
            }
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    async addVideoFav(ticket: string, objID: string) {
        const uid = await this.getUserIDByTicket(ticket);
        if (!uid) {
            return;
        }
        await this.query("insert into userfav(uid, id) values (?,?)", [
            uid,
            objID,
        ]);
    }

    async removeVideoFav(ticket: string, objID: string) {
        const uid = await this.getUserIDByTicket(ticket);
        if (uid === null) {
            return;
        }
        await this.query("delete from userfav where uid=? and id=?", [
            uid,
            objID,
        ]);
    }

    async getFavByTicket(ticket: string): Promise<string[]> {
        const uid = await this.getUserIDByTicket(ticket);
        if (uid === null) {
            return [];
        }
        const result = await this.query(
            "select * from userfav where uid=? order by updatetime desc",
            [uid]
        );
        return result.map((info) => info.id);
    }

    async getUserIDByTicket(ticket: string): Promise<string | null> {
        const result = await this.query("select * from tickets where tid=?", [
            ticket,
        ]);
        if (result.length < 1) {
            return null;
        }
        return result[0].uid;
    }

    async getHistoryByTicket(ticket: string) {
        const uid = await this.getUserIDByTicket(ticket);
        if (uid === null) {
            return [];
        }
        const results = await this.query(
            "select id, max(updatetime) as lasttime from history where username=? group by id order by max(updatetime) desc",
            [uid]
        );
        return results.map((row) => {
            return z
                .object({
                    id: z.string(),
                    lasttime: z.date(),
                })
                .parse(row);
        });
    }

    async createTicket(uid: string, durationMs: number) {
        const ticket = GetSha256(`${uid}${GenerateRandomSalt()}${new Date()}`);
        await this.query(
            "insert into tickets(tid, uid, expiretime) values (?,?,?)",
            [ticket, uid, new Date(Date.now() + durationMs)]
        );
        return ticket;
    }

    async getValidUser(username: string, passhash: string) {
        const uid = GetSha256(username);
        const result = await this.query("select * from accounts where uid=?", [
            uid,
        ]);
        if (result.length < 1) {
            return null;
        }

        const info = result[0];
        if (GetSha256(`${uid}${passhash}${info.salt}`) === info.password) {
            return {
                uid,
                username,
            };
        }

        return null;
    }

    async addUser(username: string, passhash: string) {
        const uid = GetSha256(username);
        const result = await this.query("select * from accounts where uid=?", [
            uid,
        ]);
        if (result.length > 0) {
            throw new Error("username already exists.");
        }
        const salt = GenerateRandomSalt();
        const storagePass = GetSha256(`${uid}${passhash}${salt}`);
        await this.query(
            "insert into accounts(uid, username, password, salt) values (?,?,?,?)",
            [uid, username, storagePass, salt]
        );
        return uid;
    }
}

module.exports = DaoClass;

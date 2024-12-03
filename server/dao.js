const crypto = require('crypto');
const { BaseDaoClass } = require('./base-dao');

function GetSha256(content) {
    return crypto.createHash('sha256')
        .update(content)
        .digest('hex');
}

function GenerateRandomSalt() {
    return Math.random().toString(36).substring(2, 15)
}

class DaoClass extends BaseDaoClass {
    // If objID not in objects, {id:undefined} will be resolved.
    async getObject(objID) {
        let results = await this.query('select * from objects where id=?', [objID])
        if(results.length < 1) {
            return null
        } else {
            return {
                id: rows[0].id,
                filename: rows[0].filename
            }
        }
    }

    async getAllObjectID() {
        let results = await this.query("select id from objects", [])
        return results.map((row) => {
            return row.id
        })
    }

    async getSingleVideoObject(videoId) {
        const results = await this.query("select videos.id,coverid,filename,mtime,fsize,videotime,watchcount,videos.createtime,videos.updatetime,tags from videos inner join objects on videos.id=objects.id where videos.id=?", [videoId]);
        if(results.length < 1) {
            return null;
        }

        const row = results[0];
        return {
            id: row.id,
            cid: row.coverid,
            fname: row.filename,
            mtime: row.mtime,
            fsize: row.fsize,
            vtime: row.videotime,
            watchcount: row.watchcount,
            createtime: row.createtime,
            updatetime: row.updatetime,
            tags: JSON.parse(row.tags || "[]"),
        }
    }

    async getVideoObjects() {
        const results = await this.query("select videos.id,coverid,filename,mtime,fsize,videotime,watchcount,vote,videos.createtime,videos.updatetime,tags from videos inner join objects on videos.id=objects.id ", [])
        return results.map(row => ({
            id: row.id,
            cid: row.coverid,
            fname: row.filename,
            mtime: row.mtime,
            fsize: row.fsize,
            vtime: row.videotime,
            watchcount: row.watchcount,
            vote: row.vote,
            createtime: row.createtime,
            updatetime: row.updatetime,
            tags: JSON.parse(row.tags || "[]"),
        }))
    }

    async getVideoWatchStat() {
        const results = await this.query(`
            select id, sum(watchtime) as totaltime, avg(watchtime) as avgtime
            from history where watchtime!=0 group by id`)
        return results.map((row) => ({
            id: row.id,
            totaltime: row.totaltime,
            avgtime: row.avgtime,
        }))
    }

    async getVideoTranscode() {
        return await this.query(`select * from transcode where encname!=''`)
    }

    async addVideoWatchByID(objID, isTranscode) {
        await this.query("update videos set watchcount=watchcount+1 where id=?", [objID])
        if (isTranscode) {
            await this.query('update transcode set watchcount=watchcount+1 where id=?', [objID])
        }
    }

    async addVideoWatchHistory(ticket, remoteIP, objID) {
        let uid = ""
        if (ticket) {
            uid = await this.getUserIDByTicket(ticket)
            if (uid === null) uid = ""
        }
        const result = await this.query("insert into history(username, host, id) values (?,?,?)", [uid, remoteIP, objID]);
        return result.insertId;
    }

    async updateVideoWatchHistory(watchId, duration) {
        await this.query("update history set watchtime=? where watchid=?", [duration, watchId])
    }

    async voteVideo(objID, vote) {
        await this.query("update videos set vote=vote+? where id=?", [vote, objID])
    }

    async addTranscodeTask(objID) {
        await this.query("insert into transcode(id) values (?) on duplicate key update encname=?", [objID, ''])
    }

    async addVideoTag(objID, value) {
        let conn = null
        try {
            conn = await this.getConnection()
            await conn.begin();
            const result = await conn.query("select * from videos where id=? for update", [objID])
            if (result.length < 1) {
                return
            }
            const data = result[0]
            const oldTags = JSON.parse(data.tags || "[]")
            if (oldTags.indexOf(value) == -1) {
                oldTags.push(value)
                await conn.query("update videos set tags=?, updatetime=updatetime where id=?", [JSON.stringify(oldTags), objID])
                await conn.commit()
            }
        } finally {
            if (conn) {
                await conn.rollback()
                conn.release()
            }
        }
    }

    async removeVideoTag(objID, value) {
        let conn = null
        try {
            conn = await this.getConnection()
            await conn.begin();
            const result = await conn.query("select * from videos where id=? for update", [objID])
            if (result.length < 1) {
                return
            }
            const data = result[0]
            const oldTags = JSON.parse(data.tags || "[]")
            if (oldTags.indexOf(value) != -1) {
                oldTags.splice(oldTags.indexOf(value), 1)
                await conn.query("update videos set tags=?, updatetime=updatetime where id=?", [JSON.stringify(oldTags), objID])
                await conn.commit();
            }
        } finally {
            if (conn) {
                await conn.rollback();
                conn.release()
            }
        }
    }

    async addVideoFav(ticket, objID) {
        let uid = await this.getUserIDByTicket(ticket)
        if (!uid) {
            return
        }
        await this.query("insert into userfav(uid, id) values (?,?)", [uid, objID])
    }

    async removeVideoFav(ticket, objID) {
        let uid = await this.getUserIDByTicket(ticket)
        if (!uid) {
            return
        }
        await this.query("delete from userfav where uid=? and id=?", [uid, objID])
    }

    async getFavByTicket(ticket) {
        let uid = await this.getUserIDByTicket(ticket)
        if (!uid) {
            return []
        }
        const result = await this.query("select * from userfav where uid=? order by updatetime desc", [uid])
        return result.map(info => info.id)
    }

    async getUserIDByTicket(ticket) {
        const result = await this.query("select * from tickets where tid=?", [ticket])
        if (result.length < 1) {
            return null
        }
        return result[0].uid
    }

    async getHistoryByTicket(ticket) {
        let uid = await this.getUserIDByTicket(ticket)
        if (!uid) {
            return []
        }
        let results = await this.query("select id, max(updatetime) as lasttime from history where username=? group by id order by max(updatetime) desc", [uid])
        return results.map((row) => {
            return {
                id: row.id,
                lasttime: row.lasttime
            }
        })
    }

    async createTicket(uid, lastMS) {
        const ticket = GetSha256(`${uid}${GenerateRandomSalt()}${new Date()}`)
        await this.query("insert into tickets(tid, uid, expiretime) values (?,?,?)", [ticket, uid, new Date(new Date().getTime() + lastMS)])
        return ticket
    }

    async loginUser(username, passhash) {
        const uid = GetSha256(username)
        let result = await this.query("select * from accounts where uid=?", [uid])
        if (result.length < 1) {
            return {
                code: -1,
                message: "wrong username or password"
            }
        }
        const info = result[0]
        if (GetSha256(`${uid}${passhash}${info.salt}`) === info.password) {
            return {
                code: 0,
                message: 'success',
                username,
                uid,
                ticket: await this.createTicket(uid, 12 * 3600 * 1000),
            }
        }
        return {
            code: -1,
            message: "wrong username or password"
        }
    }

    async addUser(username, passhash) {
        const uid = GetSha256(username)
        let result = await this.query("select * from accounts where uid=?", [uid])
        if (result.length > 0) {
            return {
                code: -1,
                message: "username already exists."
            }
        }
        const salt = GenerateRandomSalt()
        const storagePass = GetSha256(`${uid}${passhash}${salt}`)
        await this.query("insert into accounts(uid, username, password, salt) values (?,?,?,?)", [uid, username, storagePass, salt])
        return {
            code: 0,
            message: 'success',
            username,
            uid,
            ticket: await this.createTicket(uid, 12 * 3600 * 1000),
        }
    }
}

module.exports = DaoClass;

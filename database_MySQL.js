const fs = require('fs')
const mysql = require('mysql')
const crypto = require('crypto');
const { RSA_NO_PADDING } = require('constants');

function GetSha256(content) {
    return crypto.createHash('sha256')
        .update(content)
        .digest('hex');
}

function GenerateRandomSalt() {
    return Math.random().toString(36).substring(2, 15)
}

class DBProviderMySQL {
    constructor() {
        this.configure=JSON.parse(fs.readFileSync("config/mysql_config.json"))
        this.configure.connectionLimit=10
        this.pool=mysql.createPool(this.configure)
    }

    close() {
        this.pool.end()
    }

    // Utils
    async poolQuery(sql, params) {
        return new Promise((resolve, reject) => {
            this.pool.query(sql, params, (err, results, fields) => {
                if(err) {
                    return reject(err)
                } else {
                    return resolve({results, fields})
                }
            })
        })
    }

    async poolQueryResults(sql, params) {
        let {results} = await this.poolQuery(sql, params)
        return results
    }

    // call release or destroy on Connection object later.
    async getConnection() {
        return new Promise((resolve, reject)=>{
            this.pool.getConnection((err, conn) => {
                if(err) {
                    return reject(err)
                } else {
                    return resolve(conn)
                }
            })
        })
    }

    async connQuery(conn, sql, params) {
        return new Promise((resolve, reject)=>{
            conn.query(sql, params, (err, results, fields) => {
                if(err) {
                    return reject(err)
                } else {
                    return resolve({results, fields})
                }
            })
        })
    }

    async connQueryResults(conn, sql, params) {
        let {results} = await this.connQuery(conn, sql, params)
        return results
    }

    async connBegin(conn) {
        return new Promise((resolve, reject)=>{
            conn.beginTransaction((err)=>{
                if(err) {
                    return reject(err)
                } else {
                    return resolve()
                }
            })
        })
    }

    async connCommit(conn) {
        return new Promise((resolve, reject)=>{
            conn.commit((e)=>{
                if(e) {
                    return reject(e)
                } else {
                    return resolve()
                }
            })
        })
    }

    async connRollback(conn) {
        return new Promise((resolve, reject)=>{
            conn.rollback((e)=>{
                if(e) {
                    return reject(e)
                } else {
                    return resolve()
                }
            })
        })
    }

    // Begin of API Implementation

    // If objID not in objects, {id:undefined} will be resolved.
    async getObject(objID) {
        let results = await this.poolQueryResults('select * from objects where id=?', [objID])
        if(results.length < 1) {
            return null
        } else {
            return {
                id: rows[0].id,
                filename: rows[0].filename
            }
        }
    }

    async getObjectIDs() {
        let results = await this.poolQueryResults("select id from objects", [])
        return results.map((row) => {
            return row.id
        })
    }

    async getVideoObjects() {
        let results = await this.poolQueryResults("select videos.id,coverid,filename,mtime,fsize,videotime,watchcount,videos.createtime,videos.updatetime,tags from videos inner join objects on videos.id=objects.id ", [])
        return results.map((row) => {
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
        })
    }

    async addVideoWatchByID(objID) {
        await this.poolQuery("update videos set watchcount=watchcount+1 where id=?", [objID])
    }

    async addVideoWatchHistory(ticket, remoteIP, objID) {
        let uid = ""
        if (ticket) {
            uid = await this.getUserIDByTicket(ticket)
            if (uid === null) uid = ""
        }
        await this.poolQuery("insert into history(username, host, id) values (?,?,?)", [uid, remoteIP, objID])
    }

    async addVideoTag(objID, value) {
        let conn = null
        try {
            conn = await this.getConnection()
            await this.connBegin(conn)
            const result = await this.connQueryResults(conn, "select * from videos where id=? for update", [objID])
            if (result.length < 1) {
                return
            }
            const data = result[0]
            const oldTags = JSON.parse(data.tags || "[]")
            if (oldTags.indexOf(value) == -1) {
                oldTags.push(value)
                await this.connQuery(conn, "update videos set tags=?, updatetime=updatetime where id=?", [JSON.stringify(oldTags), objID])
                await this.connCommit(conn)
            }
        } finally {
            if (conn) {
                await this.connRollback(conn)
                conn.release()
            }
        }
    }

    async removeVideoTag(objID, value) {
        let conn = null
        try {
            conn = await this.getConnection()
            await this.connBegin(conn)
            const result = await this.connQueryResults(conn, "select * from videos where id=? for update", [objID])
            if (result.length < 1) {
                return
            }
            const data = result[0]
            const oldTags = JSON.parse(data.tags || "[]")
            if (oldTags.indexOf(value) != -1) {
                oldTags.splice(oldTags.indexOf(value), 1)
                await this.connQuery(conn, "update videos set tags=?, updatetime=updatetime where id=?", [JSON.stringify(oldTags), objID])
                await this.connCommit(conn)
            }
        } finally {
            if (conn) {
                await this.connRollback(conn)
                conn.release()
            }
        }
    }

    async addVideoFav(ticket, objID) {
        let uid = await this.getUserIDByTicket(ticket)
        if (!uid) {
            return
        }
        await this.poolQuery("insert into userfav(uid, id) values (?,?)", [uid, objID])
    }

    async removeVideoFav(ticket, objID) {
        let uid = await this.getUserIDByTicket(ticket)
        if (!uid) {
            return
        }
        await this.poolQuery("delete from userfav where uid=? and id=?", [uid, objID])
    }

    async getFavByTicket(ticket) {
        let uid = await this.getUserIDByTicket(ticket)
        if (!uid) {
            return []
        }
        const result = await this.poolQueryResults("select * from userfav where uid=? order by createtime desc", [uid])
        return result.map(info => info.id)
    }

    async getUserIDByTicket(ticket) {
        const result = await this.poolQueryResults("select * from tickets where tid=?", [ticket])
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
        let results = await this.poolQueryResults("select id from history where username=? group by id order by createtime desc", [uid])
        return results.map((row) => {
            return {
                id: row.id,
                createtime: row.createtime
            }
        })
    }

    async createTicket(uid, lastMS) {
        const ticket = GetSha256(`${uid}${GenerateRandomSalt()}${new Date()}`)
        await this.poolQuery("insert into tickets(tid, uid, expiretime) values (?,?,?)", [ticket, uid, new Date(new Date().getTime() + lastMS)])
        return ticket
    }

    async loginUser(username, passhash) {
        const uid = GetSha256(username)
        let result = await this.poolQueryResults("select * from accounts where uid=?", [uid])
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
        let result = await this.poolQueryResults("select * from accounts where uid=?", [uid])
        if (result.length > 0) {
            return {
                code: -1,
                message: "username already exists."
            }
        }
        const salt = GenerateRandomSalt()
        const storagePass = GetSha256(`${uid}${passhash}${salt}`)
        await this.poolQueryResults("insert into accounts(uid, username, password, salt) values (?,?,?,?)", [uid, username, storagePass, salt])
        return {
            code: 0,
            message: 'success',
            username,
            uid,
            ticket: await this.createTicket(uid, 12 * 3600 * 1000),
        }
    }
}

module.exports=DBProviderMySQL
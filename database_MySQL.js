const fs=require('fs')
const mysql=require('mysql')

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

    async addVideoWatchHistory(username, remoteIP, objID) {
        await this.poolQuery("insert into history(username, host, id) values (?,?,?)", [username, remoteIP, objID])
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

    async getRecentByUser(username) {
        let results = await this.poolQueryResults("select * from history where username=? order by createtime desc", [username])
        return results.map((row) => {
            return {
                id: row.id,
                createtime: row.createtime
            }
        })
    }
}

module.exports=DBProviderMySQL
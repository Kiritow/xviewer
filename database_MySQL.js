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
        let results = await this.poolQueryResults("select videos.id,coverid,filename,mtime,fsize,videotime,watchcount from videos inner join objects on videos.id=objects.id ", [])
        return results.map((row) => {
            return {
                id: row.id,
                cid: row.coverid,
                fname: row.filename,
                mtime: row.mtime,
                fsize: row.fsize,
                vtime: row.videotime,
                watchcount: row.watchcount
            }
        })
    }

    async addVideoWatchByID(objID) {
        await this.poolQuery("update videos set watchcount=watchcount+1 where id=?", [objID])
    }
}

module.exports=DBProviderMySQL
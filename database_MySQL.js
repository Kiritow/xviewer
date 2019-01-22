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

    isTableExists(tablename) {
        return new Promise((resolve,reject)=>{
            this.pool.query("show tables",(err,results,fields)=>{
                if(err) return reject(err)
                else {
                    if(results.length==0) {
                        return resolve(false)
                    }
                    for(let i=0;i<results.length;i++) {
                        for(let x in results[i]) {
                            console.log(`Has Table: ${results[i][x]}`)
                            if(results[i][x]==tablename) {
                                return resolve(true)
                            }
                        }
                    }
                    return resolve(false)
                }
            })
        })
    }

    createSingleTable(sql) {
        return new Promise((resolve,reject)=>{
            this.pool.query(sql,(err)=>{
                if(err) return reject(err)
                else return resolve()
            })
        })
    }

    async createTables() {
        let pArr=new Array
        if(!(await this.isTableExists('objects'))) {
            pArr.push(this.createSingleTable('create table objects ( id varchar(255) primary key, filename varchar(255) not null, mtime int, fsize int )'))
        }
        if(!(await this.isTableExists('covers'))) {
            pArr.push(this.createSingleTable('create table covers (id varchar(255) primary key, foreign key(id) references objects(id) )'))
        }
        if(!(await this.isTableExists('videos'))) {
            pArr.push(this.createSingleTable('create table videos (id varchar(255) primary key, coverid varchar(255), watchcount int, uploader varchar(255), tags varchar(255), foreign key(id) references objects(id), foreign key(coverid) references objects(id) )'))
        }
    }

    addObject(objID,objName,objMtime,objSize) {
        return new Promise((resolve,reject)=>{
            this.pool.query('insert into objects(id,filename,mtime,fsize) values (?,?,?,?) ',[objID,objName,objMtime,objSize],(err)=>{
                if(err) return reject(err)
                else return resolve()
            })
        })
    }

    // TODO FIXME
    // Connection may leak if the promise is rejected before reach here.
    // Separate different mysql operations in multiple async functions maybe better?
    async addVideoObject(objID,objName,objMtime,objSize,uploader,tags,coverID) {
        let conn=await this.getConnection()
        try {
            await this.beginTransaction(conn)
            await this.rawQuery(conn,'insert into objects(id,filename,mtime,fsize) values (?,?,?,?) ',[objID,objName,objMtime,objSize])
            await this.rawQuery(conn,'insert into videos(id,coverid,uploader,tags,watchcount) values (?,?,?,?,?)',[objID,coverID,uploader,tags,0])
            await this.commitTransaction(conn)
        } catch (e) {
            console.log(`Fatal Connection Eror: ${e.toString()}. Destroying single connection.`)
            conn.destroy()
            throw e // re-throw it
        }

        try {
            this.pool.releaseConnection(conn)
        } catch (e) {
            console.log(`Unable to release connection: ${e.toString()}`)
        }
    }

    // If objID not in objects, {id:undefined} will be resolved.
    getObject(objID) {
        return new Promise((resolve,reject)=>{
            this.pool.query('select * from objects where id=?',[objID],(err,rows)=>{
                if(err) return reject(err)
                else return resolve({
                    id:rows[0].id,
                    filename:rows[0].filename
                })
            })
        })
    }

    getObjectIDs() {
        return new Promise((resolve,reject)=>{
            this.pool.query("select id from objects",(err,rows)=>{
                if(err) return reject(err)
                else {
                    let arr=new Array
                    for(let i=0;i<rows.length;i++) {
                        arr.push(rows[i].id)
                    }
                    return resolve(arr)
                }
            })
        })
    }

    getVideoObjects() {
        return new Promise((resolve,reject)=>{
            this.pool.query("select videos.id,coverid,filename,mtime,fsize from videos inner join objects on videos.id=objects.id ",(err,rows)=>{
                if(err) return reject(err)
                else {
                    let arr=new Array
                    rows.forEach((row)=>{
                        let j={}
                        j.id=row.id
                        j.cid=row.coverid
                        j.fname=row.filename
                        j.mtime=new Date(row.mtime*1000)
                        j.fsize=row.fsize
                        arr.push(j)
                    })
                    return resolve(arr)
                }
            })
        })
    }

    addVideoWatchByID(objID) {
        return new Promise((resolve,reject)=>{
            this.pool.query("update videos set watchcount=watchcount+1 where id=?",[objID],(err)=>{
                if(err) return reject(err)
                else return resolve()
            })
        })
    }

    getConnection() {
        return new Promise((resolve,reject)=>{
            this.pool.getConnection((err,conn)=>{
                if(err) return reject(err)
                else return resolve(conn)
            })
        })
    }

    beginTransaction(conn) {
        return new Promise((resolve,reject)=>{
            conn.beginTransaction((err)=>{
                if(err) return reject(err)
                else return resolve()
            })
        })
    }

    commitTransaction(conn) {
        return new Promise((resolve,reject)=>{
            conn.commit((err)=>{
                if(err) return reject(err)
                else return resolve()
            })
        })
    }

    rawQuery(conn,sql,opts) {
        return new Promise((resolve,reject)=>{
            conn.query(sql,opts,(err,res)=>{
                if(err) return reject(err)
                else return resolve(res)
            })
        })
    }

    async removeVideoObject(objID) {
        let conn=await this.getConnection()
        try {
            await this.beginTransaction(conn)
            let result=await this.rawQuery(conn,'select coverid from videos where id=?',[objID])
            await this.rawQuery(conn,'delete from videos where id=?',[objID])
            await this.rawQuery(conn,'delete from objects where id=?',[result[0].coverid])
            await this.rawQuery(conn,'delete from objects where id=?',[objID])
            await this.commitTransaction(conn)
        } catch (e) {
            console.log(`Fatal Connection Eror: ${e.toString()}. Destroying single connection.`)
            conn.destroy()
            throw e // re-throw it
        }

        try {
            this.pool.releaseConnection(conn)
        } catch (e) {
            console.log(`Unable to release connection: ${e.toString()}`)
        }
    }
}

module.exports=DBProviderMySQL
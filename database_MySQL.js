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
            pArr.push(this.createSingleTable('create table videos (id varchar(255) primary key, coverid varchar(255), uploader varchar(255), tags varchar(255), foreign key(id) references objects(id), foreign key(coverid) references objects(id) )'))
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
    addVideoObject(objID,objName,objMtime,objSize,uploader,tags,coverID) {
        return new Promise((resolve,reject)=>{
            this.pool.getConnection((err,conn)=>{
                if(err) return reject(err)
                // insert into objects and videos or not at the same time.
                conn.beginTransaction((err)=>{
                    if(err) return reject(err)
                    conn.query('insert into objects(id,filename,mtime,fsize) values (?,?,?,?) ',[objID,objName,objMtime,objSize],(err)=>{
                        if(err) return reject(err)
                        conn.query('insert into videos(id,coverid,uploader,tags) values (?,?,?,?)',[objID,coverID,uploader,tags],(err)=>{
                            if(err) return reject(err)

                            conn.commit((err)=>{
                                if(err) return reject(err)

                                this.pool.releaseConnection(conn)
                                return resolve()
                            })
                        })
                    })
                })
            })
        })
    }

    // If objID not in objects, {id:undefined} will be resolved.
    getObject(objID) {
        return new Promise((resolve,reject)=>{
            this.pool.query('select * from objects where id=?',[objID],(err,rows)=>{
                if(err) return reject(err)
                else return resolve({
                    id:rows.id,
                    filename:rows.filename
                })
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
}

module.exports=DBProviderMySQL
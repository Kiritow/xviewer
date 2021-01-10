// oops, sql.js is not THAT good enough. Switched to sqlite3.
const sqlite=require('sqlite3')

class DatabaseImplSQLite3 {
    constructor() {
        this.db=new sqlite.Database("xviewer_site.db")
    }

    close() {
        return new Promise((resolve,reject)=>{
            this.db.close((err)=>{
                if(err) return reject(err)
                else return resolve()
            })
        })
    }

    isTableExists(tableName) {
        return new Promise((resolve,reject)=>{
            this.db.get("select count(*) as n from sqlite_master where type=? and tbl_name=?",["table",tableName],(err,row)=>{
                if(err) return reject(err)
                else return resolve( (row.n==1) )
            })
        })
    }

    rawExec(sql) {
        return new Promise((resolve,reject)=>{
            this.db.exec(sql,(err)=>{
                if(err) return reject(err)
                else return resolve()
            })
        })
    }

    rawRun(sql,params) {
        return new Promise((resolve,reject)=>{
            this.db.run(sql,params,(err)=>{
                if(err) return reject(err)
                else return resolve()
            })
        })
    }

    rawGet(sql,params) {
        return new Promise((resolve,reject)=>{
            this.db.get(sql,params,(err,row)=>{
                if(err) return reject(err)
                else return resolve(row)
            })
        })
    }

    rawAll(sql,params) {
        return new Promise((resolve,reject)=>{
            this.db.all(sql,params,(err,rows)=>{
                if(err) return reject(err)
                else return resolve(rows)
            })
        })
    }

    async createTables() {
        if(!(await this.isTableExists('objects'))) {
            await this.rawExec('create table objects ( id varchar(255) primary key, filename varchar(255) not null, mtime int, fsize int )')
        }
        if(!(await this.isTableExists('covers'))) {
            this.rawExec('create table covers (id varchar(255) primary key, foreign key(id) references objects(id) )')
        }
        if(!(await this.isTableExists('videos'))) {
            this.rawExec('create table videos (id varchar(255) primary key, coverid varchar(255), watchcount int, uploader varchar(255), tags varchar(255), foreign key(id) references objects(id), foreign key(coverid) references objects(id) )')
        }
    }

    async addObject(objID,objName,objMtime,objSize) {
        await this.rawRun('insert into objects(id,filename,mtime,fsize) values (?,?,?,?) ',[objID,objName,objMtime,objSize])
    }

    async addVideoObject(objID,objName,objMtime,objSize,uploader,tags,coverID) {
        try {
            await this.rawExec("BEGIN")
        } catch (e) {
            console.log(`SQLite3-DB: Can't start transaction. ${e.toString()}`)
            throw e
        }

        try {
            await this.rawRun('insert into objects(id,filename,mtime,fsize) values (?,?,?,?) ',[objID,objName,objMtime,objSize])
            await this.rawRun('insert into videos(id,coverid,uploader,tags,watchcount) values (?,?,?,?,?)',[objID,coverID,uploader,tags,0])
            await this.rawExec("COMMIT")
            console.log("SQLite3-DB: Commit")
        } catch (e) {
            try {
                await this.rawExec("ROLLBACK")
                console.log("SQLite3-DB: Rollback")
            } catch (e) {
                console.log(`SQLite3-DB: Rollback Error (suppressed): ${e.toString()}`)
            }

            throw e
        }
    }

    async getObject(objID) {
        let row=await this.rawGet('select id,filename from objects where id=?',[objID])
        return {
            id:row.id,
            filename:row.filename
        }
    }

    async getObjectIDs() {
        let rows=await this.rawAll("select id from objects",[])
        let arr=new Array
        for(let i=0;i<rows.length;i++) {
            arr.push(rows[i].id)
        }
        return arr
    }

    async getVideoObjects() {
        let rows=await this.rawAll("select videos.id,coverid,filename,mtime,fsize from videos inner join objects on videos.id=objects.id ",[])
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
        return arr
    }
    
    async addVideoWatchByID(objID) {
        await this.rawRun("update videos set watchcount=watchcount+1 where id=?",[objID])
    }
}

module.exports=DatabaseImplSQLite3
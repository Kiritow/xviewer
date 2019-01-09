const sqlite=require('sqlite3')

class XViewerDatabase {
    constructor() {
        this.database=new sqlite.Database("xviewer_site.db")
    }

    getdb() {
        return this.database
    }

    get(sql,para) {
        return new Promise((resolve,reject)=>{
            this.database.get(sql,para,(err,row)=>{
                if(err) reject(err)
                else resolve(row)
            })
        })
    }

    exec(sql) {
        return new Promise((resolve,reject)=>{
            this.database.exec(sql,(err)=>{
                if(err) reject(err)
                else resolve()
            })
        })
    }
}

module.exports=XViewerDatabase
const sqlite=require('sqlite3')

class XViewerDatabase {
    constructor() {
        this.database=new sqlite.Database("xviewer_site.db")
    }

    getdb() {
        return this.database
    }

    get() {
        let obj=this
        return new Promise((resolve,reject)=>{
            obj.getdb().get(...arguments,(err,row)=>{
                if(err) reject(err)
                else resolve(row)
            })
        })
    }

    exec() {
        return new Promise((resolve,reject)=>{
            this.getdb().exec(...arguments,(xobj,err)=>{
                if(err) reject(err)
                else resolve()
            })
        })
    }
}

module.exports=XViewerDatabase
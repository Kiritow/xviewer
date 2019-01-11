const sqlite=require('sql.js')

class DatabaseImplSQLite3 {
    constructor() {
        this.db=new sqlite.Database("xviewer_site.db")
    }

    isTableExists(tableName) {
        return new Promise((resolve,reject)=>{
            db.get("select count(*) as n from sqlite_master where type=? and tbl_name='objects'")
        })
    }

    
}

module.exports=DatabaseImplSQLite3
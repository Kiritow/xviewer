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
                            console.log(results[i][x])
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

    createTable(tableName,ddl) {
        return new Promise((resolve,reject)=>{
            this.pool.query('create table ' + tableName + ' (' + ddl + ') ',(err)=>{
                if(err) {
                    return reject(err)
                } else {
                    return resolve()
                }
            })
        })
    }

    addObject(objID,objName) {
        return new Promise((resolve,reject)=>{
            this.pool.query('insert into objects values (?,?) ',[objID,objName],(err)=>{
                if(err) return reject(err) 
                else return resolve()
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
}

module.exports=DBProviderMySQL
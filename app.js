const fs=require('fs')
const http=require('http')
const url=require('url')
const path=require('path')
const spawn=require('child_process').spawn
const crypto=require('crypto')
const promisify=require('util').promisify

const websocket=require('websocket')
const mime=require('mime')

const Database = require('./database')

// -------------- Configuration ---------------
const LISTEN_PORT = 9889

const ROOT_DIR="F:\\faaq\\OutSideVideo"

// Spawn concurrency control. Set to INFINITY to ignore this limit.
const MAX_SPAWN=8 

const DatabaseProvider = require('./database_MySQL')

// ---------- End of configuration ------------

const XVIEWER_VERSION = JSON.parse(fs.readFileSync("package.json")).version
const db=new Database(new DatabaseProvider())

async function InitDB() {
    // TODO, FIXME
    // table `objects` may vary between versions.
    await db.createTables()
}

function GetFileHash(filepath) {
    return new Promise((resolve)=>{
        let hash=crypto.createHash('sha256')
        let input=fs.createReadStream(filepath)
        input.on('data',(data)=>{
            hash.update(data)
        })
        input.on('end',()=>{
            return resolve(hash.digest('hex'))
        })
    })
}

let CURRENT_SPAWN = 0

// Kind of stupid...
function NewSpawn(command,parameter) {
    if(CURRENT_SPAWN < MAX_SPAWN) {
        ++CURRENT_SPAWN
        return new Promise((resolve)=>{
            let child=spawn(command,parameter)
            child.on('close',function(){
                --CURRENT_SPAWN
                return resolve()
            })
        })
    } else {
        return new Promise((resolve)=>{
            function this_cb() {
                if(CURRENT_SPAWN<MAX_SPAWN) {
                    ++CURRENT_SPAWN
                    let child=spawn(command,parameter)
                    child.on('close',function(){
                        --CURRENT_SPAWN
                        return resolve()
                    })
                } else {
                    setTimeout(this_cb,1000)
                }
            }
            setTimeout(this_cb,1000)
        })
    }
}

function GenerateCover(filePath,outputPath) {
    return NewSpawn('bin/ffmpeg.exe',[
        '-ss',
        '00:00:05.000',
        '-i',filePath,
        '-vframes','1',
        outputPath,
        '-y']
    )
}

async function CheckSingleObject(objname) {
    let filepath=path.join(ROOT_DIR,"objects",objname)
    let stats=await promisify(fs.stat)(filepath)
    let hashcode=await GetFileHash(filepath)
    if(objname!=hashcode) {
        try {
            await db.addObject(hashcode,objname,Math.floor(stats.mtimeMs/1000),stats.size)
            console.log(`Renaming Object: ${objname} --> ${hashcode}`)
            await promisify(fs.rename)(filepath,path.join(ROOT_DIR,"objects",hashcode))
        } catch (e) {
            if(e.code && e.code=="ER_DUP_ENTRY") {
                // Primary key duplicated, which means we have already had this file.
                // Then we should just skip it. (leave the original file on the disk.)
                console.log(`Duplicated file: ${objname}`)
            } else {
                throw e // something wrong
            }
        }
    }
    return hashcode
}

async function CheckVideoObject(objname) {
    let filepath=path.join(ROOT_DIR,"objects",objname)
    let stats=await promisify(fs.stat)(filepath)
    let hashcode=await GetFileHash(filepath)
    if(objname!=hashcode) {
        try {
            let coverPath=path.join(ROOT_DIR,"temp",hashcode + ".png")
            console.log(`Generating Cover: ${objname}`)
            await GenerateCover(filepath,coverPath)
            let coverStats=await promisify(fs.stat)(coverPath)
            let coverhash=await GetFileHash(coverPath)
            try {
                await db.addObject(coverhash,path.basename(objname,'.mp4')+'.png',Math.floor(coverStats.mtimeMs/1000),coverStats.size)
                await promisify(fs.rename)(coverPath,path.join(ROOT_DIR,"objects",coverhash))
            } catch (e) {
                if(e.code && e.code=="ER_DUP_ENTRY") {
                    console.log(`Duplicated cover: ${coverhash}`)
                } else {
                    throw e // something wrong
                }
            }
            await db.addVideoObject(hashcode,objname,Math.floor(stats.mtimeMs/1000),stats.size,"local","[]",coverhash)
            console.log(`Renaming Object: ${objname} --> ${hashcode}`)
            await promisify(fs.rename)(filepath,path.join(ROOT_DIR,"objects",hashcode))
        } catch (e) {
            if(e.code && e.code=="ER_DUP_ENTRY") {
                console.log(`Duplicated file: ${objname}`)
            } else {
                throw e // something wrong
            }
        }
    }
    return hashcode
}

function CheckObjects() {
    return new Promise( (resolve,reject)=>{
        fs.readdir(path.join(ROOT_DIR,"objects"),(err,files)=>{
            console.log(`${files.length} files found.`)
            if(err) return reject(err)
            let pArr=new Array
            files.forEach((val)=>{
                let extname=path.extname(val).toLowerCase()
                if(extname==".mp4" || extname==".vdat" ) {
                    pArr.push(CheckVideoObject(val))
                }
            })
            Promise.all(pArr).then(()=>{
                resolve()
            }).catch((e)=>{
                reject(e)
            })
        })
    })
}

function CollectData(top_resolve,top_reject) {
    db.getVideoObjects().then((data)=>{
        top_resolve(data)
    }).catch((err)=>{
        top_reject(err)
    })
}

async function RollbackSingleVideo(info) {
    let isExist=true
    try {
        // If file not exists, an error is thrown.
        await promisify(fs.access)(path.join(ROOT_DIR,"objects",info.fname))
    } catch (e) {
        if(e.code=="ENOENT") isExist=false
        else throw e // Re-Throw it
    }

    if(isExist) {
        console.log(`Same name file detected. Not changed: ${info.id} --X--> ${info.fname}`)
    } else {
        try {
            await db.removeVideoObject(info.id)
        } catch (e) {
            console.log(`DB operation failed (suppressed) ${e.toString()} Not changed: ${info.id} --X--> ${info.fname}`)
            return
        }

        try {
            await promisify(fs.rename)(path.join(ROOT_DIR,"objects",info.id),path.join(ROOT_DIR,"objects",info.fname))
            await promisify(fs.unlink)(path.join(ROOT_DIR,"objects",info.cid))
        } catch (e) {
            console.log(`File operation failed (suppressed) ${e.toString()}.`)
        }

        console.log(`Rollback Done: ${info.id} ----> ${info.fname}`)
    }
}

// WARNING: This function will delete data from database and rename objects to normal filename.
async function RollbackVideos() {
    console.log("[WARN] About to rollback video objects...")
    try {
        let objs=await db.getVideoObjects()
        let pArr=new Array
        for(let i=0;i<objs.length;i++) {
            pArr.push(RollbackSingleVideo(objs[i]))
        }
        await Promise.all(pArr)
        console.log("[Done] Video objects rollback finished.")
    } catch (e) {
        console.log(`Error: ${e}`)
    }
}

function request_handler(req,res) {
    let obj=url.parse(req.url,true)
    //console.log(obj)
    //console.log(req.headers)
    // console.log(obj.pathname)
    if(obj.pathname=='/') {
        res.writeHead(200,{
            'Content-Type':'text/html',
            'Cache-Control':'no-cache',
        })
        fs.createReadStream('static/index.html').pipe(res)
    } else if(obj.pathname=="/list") {
        new Promise((resolve,reject)=>{
            CollectData(resolve,reject)
        }).then((videos)=>{
            console.log("/list: In promise.all")
            res.writeHead(200,{"Content-Type":"text/plain"})
            res.end(JSON.stringify(videos))
        }).catch((reason)=>{
            res.writeHead(500,"Server Error")
            res.end(reason.toString())
        })
    } else if(obj.pathname=="/update_cover") {
        res.writeHead(403,"Operation banned.")
        res.end("Currently cover update is not supported.")
    } else if(obj.pathname.startsWith("/cover/")) {
        let objID=path.basename(decodeURI(obj.pathname))
        console.log("FetchCover: " + objID)
        let objPath=path.join(ROOT_DIR,'objects',objID)
        fs.stat(objPath,(err,stats)=>{
            if(!err && stats && stats.isFile()) {
                res.writeHead(200,{
                    'Content-Type':'image/png',
                    'Cache-Control':'max-age=180'
                })
                fs.createReadStream(objPath).pipe(res)
            } else {
                res.writeHead(404,"Not Found")
                res.end(`Object not found: ${objID}`)
            }
        })
    } else if(obj.pathname.startsWith("/video/")) {
        let objID=path.basename(decodeURI(obj.pathname))
        console.log("FetchVideo: " + objID)
        let objPath=path.join(ROOT_DIR,"objects",objID)
        fs.stat(objPath,(err,stats)=>{
            if(!err && stats && stats.isFile()) {
                res.setHeader('Content-Type','video/mpeg4')
                if(req.headers.range) {
                    let start=0
                    let end=stats.size-1
                    let result = req.headers.range.match(/bytes=(\d*)-(\d*)/);
                    if (result) {
                        if(result[1] && !isNaN(result[1])) start = parseInt(result[1])
                        if(result[2] && !isNaN(result[2])) end = parseInt(result[2])

                        console.log('A: ' + result[1] + ' B: ' + result[2])
                        console.log('start: ' + start + ' end: ' + end)
                        res.writeHeader(206,{
                            'Accept-Range':'bytes',
                            'Content-Range':`bytes ${start}-${end}/${stats.size}`
                        })
                        fs.createReadStream(objPath,{start,end}).pipe(res)
                    }
                } else {
                    res.writeHeader(200,{'Accept-Range':'bytes'})
                    fs.createReadStream(objPath).pipe(res)
                }
            } else {
                res.writeHead(404,"Not Found")
                res.end(`Object not found: ${objID}`)
            }
        })
    } else if(obj.pathname=="/video_played") {
        if(req.method=="POST") {
            let rawbody=''
            req.on('data',(chunk)=>{
                rawbody+=chunk
            })
            req.on('end',()=>{
                let j=JSON.parse(rawbody)
                console.log(`AddVideoCount: ${j.id}`)
                db.addVideoWatchByID(j.id).then(()=>{
                    res.writeHead(200,"OK")
                    res.end("watch count added.")
                }).catch((e)=>{
                    console.log(`AddVideoCount: Error: ${e.toString()}`)
                    res.writeHead(500,"Database Error")
                    res.end(e.toString())
                })
            })
        } else {
            console.log(`[WARN] Use ${req.method} with /video_played`)
            res.writeHead(405,"Use POST instead.")
            res.end()
        }
    } else if(obj.pathname=="/rollback_videos") {
        if(req.method=="POST") {
            RollbackVideos().then(()=>{
                res.writeHead(200,"OK")
                res.end("Rollback Video Operation Finished.")
            }).catch((e)=>{
                res.writeHead(500,"Operation Exception")
                res.end(`Rollback Video Operation Failed: ${e.toString()}`)
            })
        } else {
            console.log(`[WARN] Use ${req.method} with /rollback_videos`)
            res.writeHead(405,"Use POST instead.")
            res.end()
        }
    } else {
        let normalPath=path.normalize(obj.pathname)
        fs.stat(path.join('static',normalPath),(err,stat)=>{
            if(err) {
                res.writeHead(404,"Not Found")
                res.end(`file not found: ${normalPath}`)
            } else if(stat && stat.isFile()) {
                res.setHeader('Content-Type',mime.getType(normalPath))
                fs.createReadStream(path.join('static',normalPath)).pipe(res)
            } else {
                res.writeHead(403,"Forbidden")
                res.end(`list dir is forbidden: ${normalPath}`)
            }
        })
    }
}

async function main() {
    console.log(`Version: ${XVIEWER_VERSION}`)
    console.log("Checking database...")
    await InitDB()
    console.log("Checking objects...")
    let _tmchkObjBefore=new Date()
    await CheckObjects()
    console.log(`[Done] Object checking finishes in ${(new Date()-_tmchkObjBefore)/1000}s`)

    console.log("Starting server...")
    let hs=http.createServer(request_handler)
    hs.listen(LISTEN_PORT)
}

main().then(()=>{
    console.log("[Done] Server started.")
}).catch((err)=>{
    console.log(`Exception caught: ${err}`)
    console.log("Shutting down server...")
    db.close()
})
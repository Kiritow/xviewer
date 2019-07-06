const fs=require('fs')
const http=require('http')
const url=require('url')
const path=require('path')
const spawn=require('child_process').spawn
const crypto=require('crypto')
const promisify=require('util').promisify

const websocket=require('websocket')
const mime=require('mime')
const multer=require('multer')

const Database = require('./database')
const StorageProvider = require('./StorageProvider')

// -------------- Configuration ---------------
let _settings=JSON.parse(fs.readFileSync("config/settings.json"))
const LISTEN_PORT = _settings.port
const ROOT_DIR = _settings.rootdir
const MAX_SPAWN = _settings.maxspawn
const DatabaseProvider = require(_settings.dbprovider)
const LOG_OUTPUT = _settings.logname
const REMOTEFS_LIST = _settings.remotefs
const REMOTEFS_LINKTYPE = _settings.remotefs_linktype
// ---------- End of configuration ------------

let _logOutput=fs.createWriteStream(LOG_OUTPUT)
let _oldLog=console.log
console.log=function(str) {
    _oldLog(str)
    _logOutput.write(str + "\n")
}
console.log("Logger Initialized.")

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
         // Default highWaterMark (or buffer size) is 64K. Change it to 10M dramatically reduces time of reading large files.
        let input=fs.createReadStream(filepath,{highWaterMark:10*1024*1024})
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
function NewSpawn(command,parameter,onData,onErrData,onClose) {
    if(CURRENT_SPAWN < MAX_SPAWN) {
        ++CURRENT_SPAWN
        return new Promise((resolve)=>{
            let child=spawn(command,parameter)
            if(onData) {
                child.stdout.on('data',onData)
            }
            if(onErrData) {
                child.stderr.on('data',onErrData)
            }
            child.on('close',function(){
                if(onClose) onClose()
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
                    if(onData) {
                        child.stdout.on('data',onData)
                    }
                    if(onErrData) {
                        child.stderr.on('data',onErrData)
                    }
                    child.on('close',function(){
                        if(onClose) onClose()
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

async function CheckVideoObject(objname,szAdder) {
    let filepath=path.join(ROOT_DIR,"objects",objname)
    let stats=await promisify(fs.stat)(filepath)
    console.log(`Computing hash: ${objname}`)
    let hashcode=await GetFileHash(filepath)
    if(objname!=hashcode) {
        try {
            let coverPath=path.join(ROOT_DIR,"temp",hashcode + ".png")
            console.log(`Generating Cover: ${objname}`)
            await GenerateCover(filepath,coverPath)
            let coverStats=await promisify(fs.stat)(coverPath)
            let coverhash=await GetFileHash(coverPath)
            try {
                await db.addObject(coverhash,path.basename(objname,path.extname(objname))+'.png',Math.floor(coverStats.mtimeMs/1000),coverStats.size)
                await promisify(fs.rename)(coverPath,path.join(ROOT_DIR,"objects",coverhash))
            } catch (e) {
                if(e.code && (e.code=="ER_DUP_ENTRY" || e.code=="SQLITE_CONSTRAINT") ) {
                    console.log(`Duplicated cover: ${coverhash}`)
                } else {
                    throw e // something wrong
                }
            }
            await db.addVideoObject(hashcode,objname,Math.floor(stats.mtimeMs/1000),stats.size,"local","[]",coverhash)
            console.log(`Renaming Object: ${objname} --> ${hashcode}`)
            await promisify(fs.rename)(filepath,path.join(ROOT_DIR,"objects",hashcode))
        } catch (e) {
            if(e.code && (e.code=="ER_DUP_ENTRY" || e.code=="SQLITE_CONSTRAINT") ) {
                console.log(`Duplicated file: ${objname}`)
            } else {
                throw e // something wrong
            }
        }
    }

    if(szAdder) {
        szAdder(stats.size)
    }
    return hashcode
}

async function CheckVideoObjectProtected(addErr,objname,szAdder) {
    try {
        return await CheckVideoObject(objname,szAdder)
    } catch (e) {
        addErr()
        console.log(`suppressed error: ${e.toString()}`)
    }
}

function CheckObjects() {
    let szTotal=0
    function szAdder(sz) {
        szTotal+=sz
    }
    let errTotal=0
    function addErr() {
        ++errTotal
    }
    return new Promise( (resolve,reject)=>{
        fs.readdir(path.join(ROOT_DIR,"objects"),(err,files)=>{
            console.log(`${files.length} files found.`)
            if(err) return reject(err)
            let pArr=new Array
            files.forEach((val)=>{
                let extname=path.extname(val).toLowerCase()
                if(extname == ".mp4" || extname == ".vdat" ||
                   extname == ".flv" || extname == ".rmvb" ||
                   extname == ".mov" || extname == ".mkv" ||
                   extname == ".avi" || extname == ".wmv" ) {
                    pArr.push(CheckVideoObjectProtected(addErr,val,szAdder))
                }
            })
            Promise.all(pArr).then(()=>{
                if(errTotal>0) reject(`At least ${errTotal} error happens while checking video object`)
                else resolve(szTotal)
            }).catch((e)=>{
                reject(e)
            })
        })
    })
}

async function CompareSingleObject(id) {
    try {
        await promisify(fs.access)(path.join(ROOT_DIR,"objects",id))
    } catch (e) {
        console.log(`ObjectMissing: ${id}`)
        throw e
    }
}

async function CompareObjects() {
    let pArr=new Array
    let objs=await db.getObjectIDs()
    for(let i=0;i<objs.length;i++) {
        pArr.push(CompareSingleObject(objs[i]))
    }
    await Promise.all(pArr)
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

async function UpdateVideoInfo() {
    console.log("[Pending] About to update all video info...")
    try {
        let objs=await db.getVideoObjects()
        let pArr=new Array
        objs.forEach((val)=>{
            let dataChunk=''
            let errChunk=''
            pArr.push(NewSpawn('bin/ffprobe.exe',[path.join(ROOT_DIR,"objects",val.id)],
            (data)=>{
                dataChunk+=data
            },(data)=>{
                errChunk+=data
            },()=>{

            }))
        })
    } catch (e) {
        console.log(e)
    }
}

async function request_video(req,res) {
    let objID=path.basename(decodeURI(url.parse(req.url,true).pathname))
    console.log("FetchVideo: " + objID)
    let objPath=path.join(ROOT_DIR,"objects",objID)

    try {
        let objInfo=await db.getObject(objID)
        let mimeType=mime.getType(path.extname(objInfo.filename))
        if(mimeType==null) mimeType="video/mpeg4"
        let stats=await promisify(fs.stat)(objPath)

        if(stats && stats.isFile()) {
            res.setHeader('Content-Type',mimeType)
            if(req.headers.range) {
                let start=0
                let end=stats.size-1
                let result = req.headers.range.match(/bytes=(\d*)-(\d*)/);
                if (result) {
                    if(result[1] && !isNaN(result[1])) start = parseInt(result[1])
                    if(result[2] && !isNaN(result[2])) end = parseInt(result[2])

                    console.log(`A: ${result[1]} B: ${result[2]}`)
                    console.log(`start: ${start} end: ${end}`)
                    console.log(`objPath: ${objPath}`)
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
            throw new Error("Object not found.")
        }
    } catch (e) {
        console.log(`Failed to get video object: ${objID}. ${e.toString()}`)
        res.writeHead(404,"Not Found")
        res.end(`Object not found: ${objID}. Exception: ${e.toString()}`)
    }
}

async function request_upload_raw(req,res) {
    let data=''
    req.on('data',(chunk)=>{
        data+=chunk
    })
    req.on('end',()=>{
        console.log(`File received. Length: ${data.length}`)
        console.log(req)
        res.writeHead(200,"OK")
        res.end("File upload finished. But we are not saving it, because it is just a test.")
    })
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
    } else if(obj.pathname=="/upload_raw") {
        if(req.method=="POST") {
            request_upload_raw(req,res)
        } else {
            res.writeHead(403,"Use POST instead.")
            res.end()
        }
    } else if(obj.pathname.startsWith("/cover/")) {
        let objID=path.basename(decodeURI(obj.pathname))
        console.log("FetchCover: " + objID)
        let objPath=path.join(ROOT_DIR,'objects',objID)
        fs.stat(objPath,(err,stats)=>{
            if(!err && stats && stats.isFile()) {
                res.writeHead(200,{
                    'Content-Type':'image/png',
                    'Cache-Control':'max-age=3600, must-revalidate'
                })
                fs.createReadStream(objPath).pipe(res)
            } else {
                res.writeHead(404,"Not Found")
                res.end(`Object not found: ${objID}`)
            }
        })
    } else if(obj.pathname.startsWith("/video/")) {
        request_video(req,res)
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
        res.writeHead(403,"Forbidden")
        res.end("Due to core developing, rollback is disabled.")
        /*
        if(req.method=="POST") {
            RollbackVideos().then(()=>{
                res.writeHead(200,"OK")
                res.end("Rollback Video Operation Finished.")
            }).catch((e)=>{
                res.writeHead(500,"Operation Exception")
                res.end(`Rollback Video Operation Failed: ${e.toString()}`)
                console.log(e)
            })
        } else {
            console.log(`[WARN] Use ${req.method} with /rollback_videos`)
            res.writeHead(405,"Use POST instead.")
            res.end("Use POST instead.")
        }
        */
    } else if(obj.pathname=="/update_video_info") {
        if(req.method=="POST") {
            UpdateVideoInfo().then(()=>{
                res.writeHead(200,"OK")
                res.end("Video info updated.")
            }).catch((e)=>{
                res.writeHead(500,"Operation Exception")
                res.end(`Update video info operation failed: ${e.toString()}`)
                console.log(e)
            })
        } else {
            console.log(`[WARN] Use ${req.method} with /update_video_info`)
            res.writeHead(405,"Use POST instead.")
            res.end("Use POST instead.")
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

function ReadableSize(size) {
    if(size>=1024*1024*1024) {
        return `${Number(size/1024/1024/1024).toFixed(2)}G`
    } else if(size>=1024*1024) {
        return `${Number(size/1024/1024).toFixed(2)}M`
    } else if(size>=1024) {
        return `${Number(size).toFixed(2)}K`
    } else {
        return `${size}B`
    }
}

async function main() {
    console.log("Initializing disk storage...")
    await promisify(fs.mkdir)(path.join(ROOT_DIR,"objects"),{recursive:true})
    await promisify(fs.mkdir)(path.join(ROOT_DIR,"temp"),{recursive:true})
    console.log("[Done] Storage Initialized.")
    console.log("Initializing database...")
    await InitDB()
    console.log("[Done] Database Initialized.")
    console.log("Checking objects...")
    let _tmchkObjBefore=new Date()
    let bytes=await CheckObjects()
    let _tmchkObjDiff=(new Date()-_tmchkObjBefore)/1000
    console.log(`[Done] Object checking finishes in ${_tmchkObjDiff}s. ${ReadableSize(bytes)} in total. (${ReadableSize(bytes/_tmchkObjDiff)}/s)`)
    console.log("Comparing database with objects on disk...")
    await CompareObjects()
    console.log("[Done] All objects found on disk.")

    console.log(`Backend version: ${XVIEWER_VERSION}`)
    console.log("Starting server...")
    let hs=http.createServer(request_handler)
    hs.listen(LISTEN_PORT)
}

let _tmServBefore=new Date()
main().then(()=>{
    console.log(`[Done] Server started in ${(new Date()-_tmServBefore)/1000}s.`)
}).catch((err)=>{
    console.log(`[Fatal] Exception caught: ${err}`)
    console.log("Shutting down server...")
    db.close()
})
const fs=require('fs')
const http=require('http')
const url=require('url')
const path=require('path')
const spawn=require('child_process').spawn

const websocket=require('websocket')

/////////// CONFIGURE ///////////
const ROOT_DIR="F:\\faaq\\OutSideVideo"
// Spawn concurrency control. Set to INFINITY to ignore this limit.
const MAX_SPAWN=8 

/////////// END OF CONFIGURE ///////////

function CollectData(files,res) {
    let pArr=new Array
    files.forEach((val)=>{
        if(path.extname(val)==".mp4") {
            console.log("Handling: " + val)
            pArr.push((()=>{
                return new Promise((resolve,reject)=>{
                    fs.stat(path.join(ROOT_DIR,val),(err,stat)=>{
                        if(err) {
                            return reject('Unable to read stat: ' + val + ": " + err)
                        }
                        return resolve({
                            name:encodeURI(path.basename(val,'.mp4')),
                            size:stat.size,
                            time:stat.mtime.toISOString().split('T')[0],
                            timestamp:parseInt(stat.mtimeMs/1000),
                            cover:encodeURI('/cover/'+path.basename(val,'.mp4')+'.png'),
                            video:encodeURI('/video/'+val)
                        })
                    })
                })
            })())
        }
    })

    Promise.all(pArr).then((results)=>{
        console.log("In promise.all")
        res.writeHead(200,{"Content-Type":"text/plain"})
        res.end(JSON.stringify({files:results}))
    }).catch((reason)=>{
        res.writeHead(500,"Server Error")
        res.end(reason.toString())
    })

    console.log("End of CollectData")
}

function NewSpawn(resolve,files,fullname,filename) {
    
}

function UpdateCover(res) {
    res.writeHead(200,{
        'Content-Type':'text/plain',
        'Cache-Control':'no-cache',
        'Connection':'close'
    })
    res.end("Update cover task scheduled.")

    fs.readdir(ROOT_DIR,(err,files)=>{
        if(err) {
            console.log("Failed to readdir.")
            SendJSON({code:-1,msg:"Failed to readdir."})
            return 
        }
    
        if(files && files.length) {
            let pArr=new Array
            let done=0
            let index=0
            let running=0
            new Promise((resolve,reject)=>{
                function next() {
                    while(running<MAX_SPAWN && index<files.length) {
                        ++running
                        new Promise((resolve,reject)=>{
                            let filename=files[index]
                            index++
                            let fullname=path.join(ROOT_DIR,filename)
                            fs.stat(fullname,(err,stats)=>{
                                if(err) {
                                    return reject("Failed to stat:" + fullname)
                                }
    
                                if(stats.isFile() && path.extname(filename,".mp4")) {
                                    console.log('COVER UPDATE: '+filename)
                                    let child=spawn('bin/ffmpeg.exe',[
                                        '-ss',
                                        '00:00:05.000',
                                        '-i',fullname,
                                        '-vframes','1',
                                        path.join(ROOT_DIR,'/cover',path.basename(filename,'.mp4')+'.png'),
                                        '-y']
                                    )
                                    child.on('close',function(code){
                                        done=done+1
                                        console.log("Done: " + filename)
                                        SendJSON({code:1,done:done,total:files.length,name:filename})
                                        return resolve()
                                    })
                                } else {
                                    done=done+1
                                    console.log("Skipped: " + filename)
                                    SendJSON({code:1,done:done,total:files.length,name:filename})
                                    return resolve()
                                }
                            })
                        }).then(()=>{
                            --running
                            next()
                        }).catch((err)=>{
                            --running
                            console.log("FAILED: Unable to update cover: ")
                            console.log(err)
                            next()
                        })
                    } // End of while

                    if(running==0) {
                        return resolve()
                    }
                }// End of function next

                next()
            }).then(()=>{
                console.log('Success: Update finished.')
                SendJSON({code:0,msg:"success"})
            }).catch((reason)=>{
                console.log('Failed: ' + reason.toString())
                SendJSON({code:-1,msg:reason.toString()})
            })
        } else {
            SendJSON({code:0,msg:"No file found."})
        }
    })
}

let hs = http.createServer((req,res)=>{
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
        fs.readdir(ROOT_DIR,(err,files)=>{
            if(err) {
                res.writeHead(500,"Unable to readdir.")
                res.end()
                return
            }

            CollectData(files,res)
            console.log("End of request")
        })
    } else if(obj.pathname=="/update_cover") {
        console.log("About to update cover...")
        UpdateCover(res)
    } else if(obj.pathname.startsWith("/cover/")) {
        let filename=path.basename(decodeURI(obj.pathname))
        console.log("COVER NAME: " + filename)
        fs.stat(path.join(ROOT_DIR,'/cover',filename),(err,stats)=>{
            if(err) {
                res.writeHead(404,"Not Found")
                res.end()
            }
            if(stats && stats.isFile()) {
                res.writeHead(200,{
                    'Content-Type':'image/png',
                    'Cache-Control':'max-age=120'
                })
                fs.createReadStream(path.join(ROOT_DIR,'/cover',filename)).pipe(res)
            } else {
                res.writeHead(404,"Not Found")
                res.end()
            }
        })
    } else if(obj.pathname.startsWith("/video/")) {
        let videoname=path.basename(decodeURI(obj.pathname))
        console.log("VIDEO NAME: " + videoname)
        fs.stat(path.join(ROOT_DIR,videoname),(err,stats)=>{
            if(err) {
                res.writeHead(404,"Not Found")
                res.end()
            }
            if(stats && stats.isFile()) {
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
                        fs.createReadStream(path.join(ROOT_DIR,videoname),{start,end}).pipe(res)
                    }
                } else {
                    res.writeHeader(200,{'Accept-Range':'bytes'})
                    fs.createReadStream(path.join(ROOT_DIR,videoname)).pipe(res)
                }
            } else {
                res.writeHead(404,"Not Found")
                res.end()
            }
        })
    } else {
        fs.stat(path.join('static',path.normalize(obj.pathname)),(err,stat)=>{
            if(err) {
                res.writeHead(404,"Not Found")
                res.end()
            } else if(stat && stat.isFile()) {
                fs.createReadStream(path.join('static',path.normalize(obj.pathname))).pipe(res)
            } else {
                res.writeHead(403,"Forbidden")
                res.end()
            }
        })
    }
})

hs.listen(9889)

let ws=new websocket.server({
    httpServer : hs,
    autoAcceptConnections : false
})

let clients=new Array

ws.on('request',(request)=>{
    try {
        let conn=request.accept('xviewer',request.origin)
        console.log('New websocket connection.')
        clients.push(conn)
        conn.on('close',(reasonCode,desc)=>{
            console.log(`websocket closed. (${reasonCode}) ${desc}`)
            try {
                clients.forEach((val,idx)=>{
                    if(val==conn) {
                        console.log("Removing ws connection from list.")
                        val.close()
                        clients.splice(idx,1)
                        throw new Error('END OF LOOP')
                    }
                })
            } catch (e) {}
        })
        conn.on('message',(data)=>{}) // Ignore client data
    } catch (e) {
        console.log('WARN: Exception: ' + e)
    }
})

function SendJSON(jsonstr) {
    let j=JSON.stringify(jsonstr)
    clients.forEach((conn)=>{
        conn.sendUTF(j)
    })
}
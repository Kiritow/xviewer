const fs=require('fs')
const http=require('http')
const path=require('path')
const express=require('express')
const uuid=require('uuid')
const promisify=require('util').promisify

const ROOT_DIR = 'D:\\POPR'
const APP_SECRET = "test_sec_key"
const STORAGE_LIMIT = 0
const STORAGE_SINGLE_LIMIT = 0
const PUBLIC_IP = "127.0.0.1"

// Upload Key
class UploadManager {
    constructor() {
        this.upload_key = new Map()
        this.clean_runner = setInterval(()=>{
            this.upload_key.forEach((item, key)=>{
                if(item.expires < new Date()) {
                    console.log(`Removing upload key ${key}`)
                    this.upload_key.delete(key)
                }
            })
        }, 60000)
    }

    addKey(filename, expireSeconds) {
        let upkey = uuid.v1()
        let expireDate= new Date()
        expireDate.setTime(expireDate.getTime() + expireSeconds * 1000)
        this.upload_key.set(upkey, {
            filename: filename,
            expires: expireDate
        })
        console.log(`Adding upload key: ${upkey} -> ${filename}`)
        return upkey
    }

    get(upkey) {
        return this.upload_key.has(upkey) ? this.upload_key.get(upkey) : null
    }
}

const uploadManager = new UploadManager()


const app = express()

app.get("/", (req, res) => {
    let serverInfo = {
        remotefs: "simple",
        version: "v1",
        storageLimit: STORAGE_LIMIT,
        storageSingleLimit: STORAGE_SINGLE_LIMIT,
        publicIP: PUBLIC_IP
    }
    res.send(JSON.stringify(serverInfo))
})

async function PostAuth(req, res) {
    try {
        let request_data = JSON.parse(await new Promise((resolve)=>{
            let data = ''
            req.on('data', (chunk) => data+=chunk)
            req.on('end', ()=>{
                return resolve(data)
            })
        }))
        req.body = request_data
    } catch (e) {
        console.log(e)
        res.status(400).send(`Unable to read request data.`)
        return
    }

    if(!req.body.skey || req.body.skey != APP_SECRET) {
        res.status(403).send("Invalid auth key.")
        return false
    } else {
        return true
    }
}

app.post("/list", async (req, res) => {
    console.log("ACCESS /list")
    
    if(!PostAuth(req, res)) return

    fs.readdir(ROOT_DIR, (err, files)=>{
        if(err) {
            console.log(err)
            res.status(500).send("Unable to fetch file list.")
        } else {
            res.send(JSON.stringify(files))
        }
    })
})

app.post('/getfile', async (req, res) => {
    console.log(`ACCESS /getfile`)
    
    if(!PostAuth(req, res)) return

    if(req.body.name) {
        try {
            let filepath = path.join(ROOT_DIR, path.normalize(req.body.name))
            if(!filepath.startsWith(ROOT_DIR)) {
                throw Error(`Invalid path: ${filepath}`)
            }
            console.log(filepath)

            let stream = null
            if (req.body.range) {
                stream = fs.createReadStream(filepath, {start: range.start, end: range.end})
            } else {
                stream = fs.createReadStream(filepath)
            }

            stream.on('error', (e) => {
                console.log("Stream error.")
                console.log(e)
                res.status(500).send("Failed while reading file.")
            })
            stream.pipe(res)
        } catch (e) {
            console.log(e)
            res.status(500).send("Failed while reading file.")
        }
    } else {
        res.status(404).send("File not found")
    }
})

app.post('/savefile', async (req, res) => {
    console.log(`ACCESS /savefile`)
    
    if(!PostAuth(req, res)) return

    if(!req.body.name) {
        res.status(400).send("Invalid request.")
    }

    res.send(JSON.stringify({"upkey": uploadManager.addKey(req.body.name, 60000)}))
})

app.post("/upload", async (req, res) => {
    console.log(`ACCESS /upload`)
    
    if (req.query && req.query.upkey) {
        let uploadInfo = uploadManager.get(req.query.upkey)

        if (uploadInfo) {
            let request_data = null
            try {
                request_data = await new Promise((resolve)=>{
                    let data = ''
                    req.on('data', (chunk) => data+=chunk)
                    req.on('end', ()=>{
                        return resolve(data)
                    })
                })
            } catch (e) {
                console.log(e)
                res.status(400).send(`Unable to read request data.`)
                return
            }

            console.log(`SaveFile ${uploadInfo.filename} Size: ${length(request_data)}`)
            try {
                await promisify(fs.access)(path.join(ROOT_DIR, uploadInfo.filename))
            } catch (e) {
                // File not exist
                fs.writeFile(path.join(ROOT_DIR, uploadInfo.filename), request_data, (err) => {
                    if (err) {
                        console.log(err)
                        res.status(500).send("Failed to write file.")
                    } else {
                        res.send("File saved.")
                    }
                })
                
                return
            }

            res.status(403).send("File overwriting is not allowed.")
            return
        }

        console.log(`Invalid key: ${req.query.upkey}`)
    }

    res.status(400).send("Invalid request")
})

app.listen(9888)

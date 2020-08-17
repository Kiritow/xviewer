const fs=require('fs')
const path=require('path')
const promisify=require('util').promisify

const koa = require('koa')
const koaRouter = require('koa-router')
const koaBodyParser = require('koa-bodyparser')
const koaJson = require('koa-json')
const koaPartialContent = require('koa-partial-content')

const Database = require('./database')

// -------------- Configuration ---------------
let _settings=JSON.parse(fs.readFileSync("config/settings.json"))
const LISTEN_PORT = _settings.port
const ROOT_DIR = _settings.rootdir
const DatabaseProvider = require(_settings.dbprovider)
const LOG_OUTPUT = _settings.logname
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

async function CollectData() {
    return await db.getVideoObjects()
}

const app = new koa()
koa.use(koaBodyParser())
koa.use(koaJson())
const part = new koaPartialContent(path.join(ROOT_DIR, "objects"))
const router = new koaRouter()

router.get('/', async (ctx) => {
    ctx.set('Cache-Control', 'no-cache')
    ctx.set('Content-Type', 'text/html')
    ctx.body = await promisify(fs.readFile)('static/index.html')
})

router.get('/list', async (ctx) => {
    try {
        let videos = await CollectData()
        ctx.set('Content-Type', 'text/plain')
        ctx.body = JSON.stringify(videos)
    } catch (e) {
        console.log(e)
        ctx.status = 500
        ctx.body = "Server Error"
    }
})

router.get('/object', (ctx) => {
    if(ctx.query.id) {
        return (part.middleware(ctx.query.id))(ctx)
    } else {
        ctx.status = 404
        ctx.body = "Object Not Found"
    }
})

router.post('/video_played', async (ctx) => {
    let postData = ctx.request.body
    console.log(`AddVideoCount: ${postData.id}`)
    try {
        await db.addVideoWatchByID(postData.id)
        ctx.body = "OK"
    } catch (e) {
        console.log(e)
        ctx.status = 500
        ctx.body = "Database Error"
    }
})

async function main() {
    console.log("Initializing disk storage...")
    await promisify(fs.mkdir)(path.join(ROOT_DIR,"objects"),{recursive:true})
    await promisify(fs.mkdir)(path.join(ROOT_DIR,"temp"),{recursive:true})
    console.log("[Done] Storage Initialized.")
    console.log("Initializing database...")
    await InitDB()
    console.log("[Done] Database Initialized.")
    console.log("Comparing database with objects on disk...")
    await CompareObjects()
    console.log("[Done] All objects found on disk.")

    console.log(`Backend version: ${XVIEWER_VERSION}`)
    console.log("Starting server...")
    app.listen(LISTEN_PORT)
}

let _tmServBefore=new Date()
main().then(()=>{
    console.log(`[Done] Server started in ${(new Date()-_tmServBefore)/1000}s.`)
}).catch((err)=>{
    console.log(`[Fatal] Exception caught: ${err}`)
    console.log("Shutting down server...")
    db.close()
})
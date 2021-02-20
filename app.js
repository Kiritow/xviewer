const fs=require('fs')
const path=require('path')
const promisify=require('util').promisify

const koa = require('koa')
const koaRouter = require('koa-router')
const koaBodyParser = require('koa-bodyparser')
const koaJson = require('koa-json')
const koaStatic = require('koa-static')
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

async function CompareSingleObject(id) {
    try {
        await promisify(fs.access)(path.join(ROOT_DIR,"objects",id))
    } catch (e) {
        console.log(`ObjectMissing: ${id}`)
        console.log(e.stack)
        throw e
    }
}

async function CompareObjects() {
    let pArr=[]
    let objs=await db.getObjectIDs()
    for(let i=0;i<objs.length;i++) {
        pArr.push(CompareSingleObject(objs[i]))
    }
    await Promise.all(pArr)
    return objs.length
}

async function CollectData() {
    return await db.getVideoObjects()
}

const app = new koa()
app.use(koaBodyParser())
app.use(koaJson())
app.use(async (ctx, next) => {
    console.log(`${ctx.method} ${ctx.url}`)
    if(ctx.url.startsWith("/video")) {
        console.log(JSON.stringify(ctx.headers, null, 2))
    }
    try {
        await next()
        console.log(JSON.stringify(ctx.response.headers, null, 2))
    } catch (e) {
        console.log(e)
        ctx.status = 500
        ctx.body = "Server Internal Error"
    }
})

const part = new koaPartialContent(path.join(ROOT_DIR, "objects"))
const router = new koaRouter()

// Tweaks
part.isMedia = () => {
    return true
}

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

router.get('/video', (ctx) => {
    if(ctx.query.id) {
        console.log(`video ${ctx.query.id}`)
        return (part.middleware(ctx.query.id))(ctx)
    } else {
        ctx.status = 404
        ctx.body = "Video Not Found"
    }
})

router.get('/cover', async (ctx) => {
    if(ctx.query.id) {
        console.log(`cover ${ctx.query.id}`)
        ctx.set('Content-Type', 'image/png')
        ctx.body = await promisify(fs.readFile)(path.join(ROOT_DIR, "objects", ctx.query.id))
    } else {
        ctx.status = 404
        ctx.body = "Cover Not Found"
    }
})

router.post('/video_played', async (ctx) => {
    const remoteIP = ctx.headers['x-forwarded-for'] || ctx.headers["x-real-ip"] || ctx.request.ip
    console.log(remoteIP)

    const postData = ctx.request.body
    console.log(postData)
    
    const videoID = postData.id
    let ticket = postData.ticket
    if (!ticket || ticket.length < 1) {
        ticket = null
    }

    console.log(`AddVideoCount: ${remoteIP} ${videoID} ${ticket}`)
    try {
        await db.addVideoWatchByID(videoID)
        await db.addVideoWatchHistory(ticket, remoteIP, videoID)
        ctx.body = "OK"
    } catch (e) {
        console.log(e)
        ctx.status = 500
        ctx.body = "Database Error"
    }
})

router.post('/add_tag', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const videoID = postData.id
    const tagValue = postData.tag

    console.log(`Add Tag: ${tagValue} to ${videoID}`)
    await db.addVideoTag(videoID, tagValue)

    ctx.body = "OK"
})

router.post('/remove_tag', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const videoID = postData.id
    const tagValue = postData.tag

    console.log(`Remove Tag: ${tagValue} from ${videoID}`)
    await db.removeVideoTag(videoID, tagValue)

    ctx.body = "OK"
})

router.post('/add_fav', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const videoID = postData.id
    const ticket = postData.ticket

    console.log(`Add Tag: ${ticket} to ${videoID}`)
    await db.addVideoFav(ticket, videoID)

    ctx.body = "OK"
})

router.post('/remove_fav', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const videoID = postData.id
    const ticket = postData.ticket

    console.log(`Remove Tag: ${ticket} from ${videoID}`)
    await db.removeVideoFav(ticket, videoID)

    ctx.body = "OK"
})

router.post('/favorites', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const ticket = postData.ticket

    ctx.body = JSON.stringify(await db.getFavByTicket(ticket))
})

router.post('/history', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const ticket = postData.ticket

    console.log(`history ${ticket}`)

    ctx.body = JSON.stringify(await db.getHistoryByTicket(ticket))
})

router.post('/login', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const username = postData.username
    const passhash = postData.password

    try {
        const data = await db.loginUser(username, passhash)
        ctx.status = 200
        ctx.body = JSON.stringify(data)
    } catch (e) {
        console.log(e)
        ctx.status = 403
        ctx.body = "login failed"
    }
})

router.post('/register', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const username = postData.username
    const passhash = postData.password

    try {
        const data = await db.addUser(username, passhash)
        ctx.status = 200
        ctx.body = JSON.stringify(data)
    } catch (e) {
        console.log(e)
        ctx.status = 403
        ctx.body = "register failed"
    }
})

app.use(koaStatic(path.join(__dirname, "static")))
app.use(router.routes()).use(router.allowedMethods())


async function main() {
    // console.log("Comparing database with objects on disk...")
    // const cntObjects = await CompareObjects()
    // console.log(`[Done] All ${cntObjects} objects found on disk.`)

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
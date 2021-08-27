const fs=require('fs')
const path=require('path')
const promisify=require('util').promisify

const koa = require('koa')
const koaRouter = require('koa-router')
const koaBodyParser = require('koa-bodyparser')
const koaJson = require('koa-json')
const koaStatic = require('koa-static')
const koaPartialContent = require('koa-partial-content')

const elasticsearch = require('elasticsearch')

const DaoClass = require('./dao')


const ROOT_DIR = '/data';
const CDN_PREFIX = process.env.CDN_PREFIX;
const ES_HOST = process.env.ES_HOST;
const ES_INDEX = process.env.ES_INDEX;
const XVIEWER_VERSION = JSON.parse(fs.readFileSync("package.json")).version
const db = new DaoClass({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
});

const esClient = elasticsearch.Client({
    host: `http://${ES_HOST}:9200`,
    log: 'trace',
    apiVersion: '7.x'
})

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
        let videos = await db.getVideoObjects()
        ctx.body = {
            videos,
            cdnPrefix: CDN_PREFIX,
        }
    } catch (e) {
        console.log(e)
        ctx.status = 500
        ctx.body = "Server Error"
    }
})

router.get('/video', (ctx) => {
    if(ctx.query.id) {
        console.log(`video ${ctx.query.id}`)
        const prefix = ctx.query.id.substr(0, 2)
        const resourcePath = `${prefix}/${ctx.query.id}`;
        if (CDN_PREFIX) {
            ctx.status = 307
            ctx.redirect(`${CDN_PREFIX}/${resourcePath}`)
            return
        }
        return (part.middleware(resourcePath))(ctx)
    }
    ctx.status = 404
    ctx.body = "Video Not Found"
})

router.get('/cover', async (ctx) => {
    if(ctx.query.id) {
        console.log(`cover ${ctx.query.id}`)
        const prefix = ctx.query.id.substr(0, 2)
        const resourcePath = `${prefix}/${ctx.query.id}`;
        if (CDN_PREFIX) {
            ctx.status = 307
            ctx.redirect(`${CDN_PREFIX}/${resourcePath}`)
            return
        }
        ctx.set('Content-Type', 'image/png')
        ctx.body = await promisify(fs.readFile)(path.join(ROOT_DIR, "objects", resourcePath))
        return
    }

    ctx.status = 404
    ctx.body = "Cover Not Found"
})

async function ESSimpleSearch(keyword, size) {
    return (await esClient.search({
        index: ES_INDEX,
        size: size,
        body: {
            query: {
                match: {
                    name: keyword
                }
            }
        }
    })).hits.hits;
}

router.get('/search', async (ctx) => {
    const kw = ctx.query.kw
    if (!kw) {
        ctx.status = 400
        ctx.body = "kw required."
        return
    }

    const response = await ESSimpleSearch(kw, 10000)

    const tempArr = []
    const tempSet = new Set()
    response.forEach((data) => {
        if(!tempSet.has(data._source.vid)) {
            tempSet.add(data._source.vid)
            tempArr.push(data._source.vid)
        }
    })

    ctx.body = tempArr
})

router.get('/recommend', async (ctx) => {
    const fromId = ctx.query.from
    if (!fromId) {
        ctx.status = 400
        ctx.body = "from required."
        return
    }

    const info = await db.getSingleVideoObject(fromId);
    if(!info) {
        ctx.body = []
        return
    }

    const response = await ESSimpleSearch(info.fname, 10)

    const tempArr = []
    const tempSet = new Set()
    response.forEach((data) => {
        if(fromId !== data._source.vid && !tempSet.has(data._source.vid)) {
            tempSet.add(data._source.vid)
            tempArr.push(data._source.vid)
        }
    })

    ctx.body = tempArr
})

router.post('/preferred', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    let ticket = postData.ticket
    if (!ticket || ticket.length < 1) {
        ticket = null
    }

    try {
        const favs = await db.getFavByTicket(ticket)
        const history = await db.getHistoryByTicket(ticket)

        const tempSet = new Set()
        for(let i=0; i<5; i++) {
            if (favs.length > 0) {
                tempSet.add(favs[Math.floor(Math.random() * favs.length)])
            }
        }

        for(let i=0; i<5; i++) {
            if (history.length > 0) {
                tempSet.add(history[Math.floor(Math.random() * history.length)].id)
            }
        }

        if(tempSet.size < 1) {
            ctx.body = {
                code: 0,
                message: 'success',
                data: {
                    videos: [],
                }
            }
            return
        }

        const infoArr = await Promise.all(Array.from(tempSet).map((id) => db.getSingleVideoObject(id)))
        const suggestArr = await Promise.all(infoArr.map((info) => ESSimpleSearch(info.fname, 10)))

        const finalSet = new Set()
        const sourceShowRate = 30
        suggestArr.forEach((hits) => {
            hits.forEach((data) => {
                if (!tempSet.has(data._source.vid)) {
                    finalSet.add(data._source.vid)
                } else if (Math.random() * 100 >= sourceShowRate) {
                    finalSet.add(data._source.vid)
                }
            })
        })

        ctx.body = {
            code: 0,
            message: 'success',
            data: {
                videos: Array.from(finalSet),
            }
        }
    } catch (e) {
        console.log(e)
        ctx.status = 500
        ctx.body = {
            code: -1,
            message: "Database Error"
        }
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
        const insertId = await db.addVideoWatchHistory(ticket, remoteIP, videoID)
        ctx.body = {
            code: 0,
            message: 'success',
            data: {
                sess: insertId
            }
        }
    } catch (e) {
        console.log(e)
        ctx.status = 500
        ctx.body = {
            code: -1,
            message: "Database Error"
        }
    }
})

router.post('/video_playing', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const { sess, duration } = postData
    if (!sess || !duration) {
        ctx.body = {
            code: -1,
            message: "sess, duration required."
        }
        return
    }

    try {
        await db.updateVideoWatchHistory(sess, duration);
        ctx.body = {
            code: 0,
            message: 'success',
        }
    } catch (e) {
        console.log(e)
        ctx.status = 500
        ctx.body = {
            code: -1,
            message: "Database Error"
        }
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

    ctx.body = await db.getFavByTicket(ticket)
})

router.post('/history', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const ticket = postData.ticket

    console.log(`history ${ticket}`)

    ctx.body = await db.getHistoryByTicket(ticket)
})

router.post('/login', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const username = postData.username
    const passhash = postData.password

    try {
        const data = await db.loginUser(username, passhash)
        ctx.status = 200
        ctx.body = data
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
        ctx.body = data
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
    app.listen(80)
}

let _tmServBefore=new Date()
main().then(()=>{
    console.log(`[Done] Server started in ${(new Date()-_tmServBefore)/1000}s.`)
}).catch((err)=>{
    console.log(`[Fatal] Exception caught: ${err}`)
    console.log("Shutting down server...")
    db.close()
})
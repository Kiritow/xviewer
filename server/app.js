const fs=require('fs')
const path=require('path')
const koa = require('koa')
const koaRouter = require('koa-router')
const koaBodyParser = require('koa-bodyparser')
const koaJson = require('koa-json')
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
    if(ctx.url.startsWith("/video")) {
        console.log(`${ctx.method} ${ctx.url} headers=${JSON.stringify(ctx.headers)}`)
    } else {
        console.log(`${ctx.method} ${ctx.url}`)
    }

    try {
        await next()
    } catch (e) {
        console.log(`${ctx.method} ${ctx.url} error: ${e}`)
        ctx.status = 500
        ctx.body = "Server internal error"
    }
})

const router = new koaRouter()

function GetHeatFromInfo(info, progressRatio) {
    const now = new Date()
    let heat = 0
    if (now - info.createtime < 1000*60*60*24*30) {
        heat += 200;
    } else if (now - info.createtime < 1000*60*60*24*90) {
        heat += 150;
    } else if (now - info.createtime < 1000*60*60*24*180) {
        heat += 100;
    } else if (now - info.createtime < 1000*60*60*24*365) {
        heat += 50;
    }

    if (info.watchcount < 1) {
        heat -= 190;
    } else if (info.watchcount < 5) {
        heat += 15 * info.watchcount * progressRatio;
    } else if (info.watchcount < 10) {
        heat += (65 + (info.watchcount - 5) * 35) * progressRatio;
    } else if (info.watchcount < 100) {
        heat += (240 + (info.watchcount - 10) * 30) * progressRatio;
    } else {
        heat += (2940 + (info.watchcount - 100) * 10) * progressRatio
    }

    return heat;
}

router.get('/api/list', async (ctx) => {
    try {
        const videos = await db.getVideoObjects()
        const videosIndex = new Map()
        videos.forEach((info) => videosIndex.set(info.id, info))

        const videoStats = await db.getVideoWatchStat()
        videoStats.forEach((sinfo) => {
            if(videosIndex.get(sinfo.id) != null) {
                sinfo.progress = sinfo.avgtime / videosIndex.get(sinfo.id).vtime
            }
        })

        const videoWatchModifier = new Map()
        const videoStatsFiltered = videoStats.filter((sinfo) => sinfo.progress != null)
        videoStatsFiltered.sort((a, b) => a.progress - b.progress)
        videoStatsFiltered.forEach((sinfo, sidx) => {
            videoWatchModifier.set(sinfo.id, 1 + (sidx + 1) / videoStatsFiltered.length)
        })

        let sumHeat = 0;
        let countHeat = 0;
        let avgHeat = 1;
        videos.forEach((info) => {
            // replace watch count with heat
            const heat = GetHeatFromInfo(info, videoWatchModifier.get(info.id) || 1)
            info.watchcount = heat;
            if (heat > 0) {
                sumHeat += heat;
                countHeat += 1;
            }
        });

        if (countHeat > 0) {
            avgHeat = sumHeat / countHeat;
        }
        videos.forEach((info) => {
            info.watchcount = info.watchcount * 100 / avgHeat;
        });

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

function isObjectExists(objectId) {
    const prefix = objectId.substr(0, 2)
    const resourcePath = `${prefix}/${objectId}`;
    const filePath = path.join(ROOT_DIR, "objects", resourcePath)

    return new Promise((resolve) => {
        fs.access(filePath, fs.constants.R_OK, (err) => resolve(err ? false : true))
    })
}

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

router.get('/api/search', async (ctx) => {
    const kw = ctx.query.kw
    if (!kw) {
        ctx.status = 400
        ctx.body = "Missing parameters"
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

router.get('/api/recommend', async (ctx) => {
    const fromId = ctx.query.from
    if (!fromId) {
        ctx.status = 400
        ctx.body = "Missing parameters"
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

router.post('/api/preferred', async (ctx) => {
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
        for(let i=0; i<8; i++) {
            if (favs.length > 0) {
                tempSet.add(favs[Math.floor(Math.random() * favs.length)])
            }
        }

        for(let i=0; i<4; i++) {
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
            message: "Database error"
        }
    }
})

router.post('/api/video_played', async (ctx) => {
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

router.post('/api/video_playing', async (ctx) => {
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

router.post('/api/add_tag', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const videoID = postData.id
    const tagValue = postData.tag

    console.log(`AddTag: video=${videoID} tag=${tagValue}`)
    await db.addVideoTag(videoID, tagValue)

    ctx.body = "OK"
})

router.post('/api/remove_tag', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const videoID = postData.id
    const tagValue = postData.tag

    console.log(`RemoveTag: video=${videoID} tag=${tagValue}`)
    await db.removeVideoTag(videoID, tagValue)

    ctx.body = "OK"
})

router.post('/api/add_fav', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const videoID = postData.id
    const ticket = postData.ticket

    console.log(`AddUserFav: video=${videoID} user=${ticket}`)
    await db.addVideoFav(ticket, videoID)

    ctx.body = "OK"
})

router.post('/api/remove_fav', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const videoID = postData.id
    const ticket = postData.ticket

    console.log(`RemoveUserFav: video=${videoID} user=${ticket}`)
    await db.removeVideoFav(ticket, videoID)

    ctx.body = "OK"
})

router.post('/api/favorites', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const ticket = postData.ticket

    ctx.body = await db.getFavByTicket(ticket)
})

router.post('/api/history', async (ctx) => {
    const postData = ctx.request.body
    console.log(postData)

    const ticket = postData.ticket

    console.log(`history ${ticket}`)

    ctx.body = await db.getHistoryByTicket(ticket)
})

router.post('/api/login', async (ctx) => {
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

router.post('/api/register', async (ctx) => {
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

app.use(router.routes()).use(router.allowedMethods())


async function PreReadObjectList() {
    const objLst = await db.getAllObjectID()
    const cntFailed = 0
    await Promise.all(objLst.map((async (objId) => {
        if (!await isObjectExists(objId)) {
            ++cntFailed
            console.log(`[WARN] object ${objId} not found on disk`)
        }
    })))
    console.log(`${objLst.length} objects checked. ${cntFailed} objects not found.`)
}

async function main() {
    console.log(`Backend version: ${XVIEWER_VERSION}`)
    console.log('Object list pre-reading...')
    await PreReadObjectList()
    // console.log("Comparing database with objects on disk...")
    // const cntObjects = await CompareObjects()
    // console.log(`[Done] All ${cntObjects} objects found on disk.`)
    console.log("Starting web server...")
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
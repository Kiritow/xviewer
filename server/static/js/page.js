function sendPost(url, data, dataType) {
    return new Promise((resolve, reject) => {
        $.post(url, data, dataType).then(resolve).catch(reject)
    })
}
function sendGet(url, dataType) {
    return new Promise((resolve, reject) => {
        $.get(url, dataType).then(resolve).catch(reject)
    })
}
function sendPostWithTimeout(url, data, dataType, timeout) {
    return new Promise((resolve, reject) => {
        $.ajax({
            method: 'POST',
            url,
            data,
            dataType,
            timeout,
            success: resolve,
            error: reject,
        });
    });
}

function ArrayRandomShuffle(arr) {
    // Do a quick Fisher–Yates shuffle
    let m = arr.length;
    while(m) {
        const i = Math.floor(Math.random() * m--);
        const temp = arr[m];
        arr[m] = arr[i];
        arr[i] = temp;
    }
}

const app=Vue.createApp({
    data: () => ({
        siteYear: "",
        cdnPrefix: "",

        rates: [0.5,0.75,1,1.25,1.5,2,2.5],
        alists: [],  // All video
        dlists: [],  // Searched result
        vlists: [],  // Visual result
        favset: new Set(),  // Favorite data
        showoffset: 0,
        showsize: 100,
        playing: -1,
        playingWatchId: null,
        handleReportPlaying: null,
        keyword: '',
        afterdate: null,
        resultCount: -1,
        servermsg: '',
        pageInputs: {
            tagInputs: []
        },
        alltags: [],
        playingRecommends: [],

        loginInProgress: false,
        inputUsername: "",
        inputPassword: "",
        currentUsername: "",
        currentTicket: "",
        loginMessage: "",
    }),
    mounted() {
        console.log("Running mounted method...")
        this.pageInputs.tagInputs = []
        for(let i=0; i<this.showsize; i++) {
            this.pageInputs.tagInputs.push({
                value: ""
            })
        }
        if (localStorage.getItem("xvcache_username")) {
            this.currentUsername = localStorage.getItem("xvcache_username")
            this.currentTicket = localStorage.getItem("xvcache_ticket")
        }

        this.siteYear = new Date().getFullYear()
    },
    computed: {

    },
    methods: {
        getCoverPath(cid) {
            if (this.cdnPrefix && this.cdnPrefix.length > 0) {
                return `${this.cdnPrefix}/${cid}`
            } else {
                return `/cover?id=${cid}`
            }
        },
        getVideoPath(vid) {
            if (this.cdnPrefix && this.cdnPrefix.length > 0) {
                return `${this.cdnPrefix}/${vid}`
            } else {
                return `/video?id=${vid}`
            }
        },
        async reloadVideoList() {
            console.log('loading video info...')
            const res = await sendGet('/list', 'json');
            console.log(`${res.videos.length} video loaded.`)

            this.alists = res.videos
            this.cdnPrefix = res.cdnPrefix
            if (this.cdnPrefix && this.cdnPrefix.length > 0) {
                console.log(`cdn detected: ${this.cdnPrefix}`)
            }

            this.generateAllTags()
        },
        async preferredShuffleOnline() {
            const result = await sendPostWithTimeout('/preferred', {
                ticket: this.currentTicket,
            }, 'json', 3000);
            console.log(`${result.data.videos.length} preferred videos`);
            const resultSet = new Set(result.data.videos);

            this.dlists = []
            const laterArr = [];

            this.alists.forEach((info) => {
                if (resultSet.has(info.id)) {
                    this.dlists.push(info)
                } else {
                    laterArr.push(info)
                }
            })

            while(this.dlists.length < 100) {
                if(laterArr.length > 0) {
                    this.dlists.push(laterArr.splice(Math.floor(laterArr.length * Math.random()), 1)[0]);
                } else {
                    break;
                }
            }
            ArrayRandomShuffle(this.dlists);
            ArrayRandomShuffle(laterArr);
            this.dlists = this.dlists.concat(laterArr);
            this.updateVisual();
        },
        async initPanel() {
            await this.reloadVideoList()
            this.showoffset = 0

            if (this.currentUsername.length > 0) {
                try {
                    await this.reloadUserFav();
                } catch (e) {
                    console.log('unable to load user fav')
                }

                try {
                    await this.preferredShuffleOnline();
                } catch (e) {
                    console.log(`Unable to load perferred videos: ${e}`)
                    this.dlists = this.alists;
                    this.randomShuffle();
                }
            } else {
                this.dlists = this.alists
                this.randomShuffle()
            }
        },
        stopVideo() {
            console.log(`Stop playing video. Previous index: ${this.playing}`)
            const videoElement = document.getElementById('video_playing')
            if(videoElement) {
                console.log(`video element found. Removing it...`)
                videoElement.pause()
                videoElement.currentTime = 0
            }
            if (this.handleReportPlaying !== null) {
                clearTimeout(this.handleReportPlaying)
                this.handleReportPlaying = null
            }
            this.playingWatchId = 0
            this.playing = -1
        },
        async analysisVideoPlayed(index) {
            return sendPost("/video_played", {
                id: this.vlists[index].id,
                ticket: this.currentTicket,
            }, 'json')
        },
        playVideo(index) {
            this.stopVideo()
            this.analysisVideoPlayed(index).then((res) => {
                console.log(res)
                if (res.code === 0) {
                    console.log(`Reporter started, watchId: ${this.playingWatchId}`)
                    let totalPlayDuration = 0
                    let lastCheckTime = new Date()

                    this.playingWatchId = res.data.sess
                    const reporter = async (interval) => {
                        try {
                            const videoElement = document.getElementById('video_playing')

                            if(videoElement && !videoElement.paused) {
                                totalPlayDuration += new Date() - lastCheckTime
                                lastCheckTime = new Date()

                                console.log(`report video playing ${this.playingWatchId} ${(totalPlayDuration / 1000).toFixed(2)}`)
                                await sendPost('/video_playing', {
                                    sess: this.playingWatchId,
                                    duration: parseInt(totalPlayDuration / 1000, 10),
                                }, 'json')
                            } else {
                                lastCheckTime = new Date()
                            }
                        } catch (e) {
                            console.log(e)
                        }

                        this.handleReportPlaying = setTimeout(reporter, interval, interval)
                    }
                    this.handleReportPlaying = setTimeout(reporter, 0, 1000)
                }
            })
            this.getRecommend(this.vlists[index].id)
            console.log(`Play video: ${index} ${this.vlists[index].id}`)
            this.playing=index
            this.$forceUpdate()
        },
        playRecommendVideo(index, recIndex) {
            this.stopVideo();
            this.vlists[index] = this.playingRecommends[recIndex]
            console.log(`Play recommend: ${index} ${recIndex}`)
            this.playVideo(index)
        },
        ReadableSize(size) {
            if(size>=1024*1024*1024) {
                return `${Number(size/1024/1024/1024).toFixed(2)}G`
            } else if(size>=1024*1024) {
                return `${Number(size/1024/1024).toFixed(2)}M`
            } else if(size>=1024) {
                return `${Number(size).toFixed(2)}K`
            } else {
                return `${size}B`
            }
        },
        ReadableDuration(second) {
            if (second < 60) {
                return `${parseInt(second, 10)}s`
            }
            if (second < 3600) {
                return `${parseInt(second / 60, 10)}分${parseInt(second % 60, 10)}秒`
            }
            return `${parseInt(second / 3600, 10)}小时${parseInt((second % 3600) / 60, 10)}分${parseInt(second % 60, 10)}秒`
        },
        ReadableHeat(heat) {
            if (heat < 0) {
                return '0%';
            }
            return `${heat.toFixed(2)}%`
        },
        adjustVideo(e) {
            console.log('adjust video')
            let video=e.srcElement
            if(video.getAttribute('adjusted') != 'yes') {
                if(video.videoWidth < 1024 || video.videoHeight < 768) {
                    console.log(`video: width=${video.videoWidth} height: ${video.videoHeight}`)
                    video.setAttribute('width',1024)
                    video.setAttribute('height',768)
                    video.setAttribute('adjusted','yes')
                }
            }
            video.currentTime = 0

            // const eventNames = ["abort", "canplay", "canplaythrough", "durationchange", "emptied", "ended", "error", "interruptbegin", "interruptend", "loadeddata", "loadstart", "mozaudioavailable", "pause", "play", "playing", "progress", "ratechange", "seeked", "seeking", "stalled", "suspend", "timeupdate", "volumechange", "waiting"]
            // let lastEventTime = new Date()
            // let waitWatchdogTimer = null
            // eventNames.forEach((name) => {
            //     video.addEventListener(name, ()=>{ 
            //         console.log(`${name} ${new Date() - lastEventTime}ms since last event.`)
            //         lastEventTime = new Date()
            //     })
            // })
            
            /*
            let playingWatchDog = null
            let lastTimeUpdate = new Date()

            video.addEventListener("play", ()=>{
                console.log(`watch dog: play`)
                playingWatchDog = setInterval(()=>{
                    if (new Date() - lastTimeUpdate > 5000) {
                        console.log(`watch dog: 5s since last timeupdate event.`)
                    }
                    if (new Date() - lastTimeUpdate > 10000) {
                        console.log(`watch dog: 10s since last timeupdate event.`)
                        const lastTime = video.currentTime;
                        console.log(`video current time is ${lastTime}`)
                        video.load()
                        video.currentTime = lastTime
                        video.play()
                        lastTimeUpdate = new Date()
                    }
                }, 1000)
            })

            video.addEventListener("timeupdate", ()=>{
                lastTimeUpdate = new Date()
            })

            video.addEventListener("pause", ()=>{
                console.log(`watch dog: pause.`)
                if (playingWatchDog) {
                    clearInterval(playingWatchDog)
                    playingWatchDog = null
                }
            })
            */
        },
        updateVisual() {
            this.stopVideo()
            console.log("update visual")
            let tmplst = []
            for(let i = this.showoffset; i < this.showoffset + this.showsize && i < this.dlists.length; i++) {
                tmplst.push(this.dlists[i])
            }
            this.vlists = tmplst
        },
        randomShuffle() {
            console.log("random shuffle started")
            ArrayRandomShuffle(this.dlists);
            console.log("random shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        countShuffle() {
            console.log("count shuffle started.")
            this.dlists.sort((a, b) => {
                return b.watchcount - a.watchcount
            })
            console.log("count shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        latestShuffle() {
            console.log("latest shuffle started.")
            this.dlists.sort((a, b) => {
                return new Date(b.mtime) - new Date(a.mtime)
            })
            console.log("latest shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        oldestShuffle() {
            console.log("oldest shuffle started.")
            this.dlists.sort((a, b) => {
                return new Date(a.mtime) - new Date(b.mtime)
            })
            console.log("oldest shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        bigShuffle() {
            console.log("big shuffle started.")
            this.dlists.sort((a, b) => {
                return new Date(b.fsize) - new Date(a.fsize)
            })
            console.log("big shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        smallShuffle() {
            console.log("small shuffle started.")
            this.dlists.sort((a, b) => {
                return new Date(a.fsize) - new Date(b.fsize)
            })
            console.log("small shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        longShuffle() {
            console.log("long shuffle started.")
            this.dlists.sort((a, b) => {
                return new Date(b.vtime) - new Date(a.vtime)
            })
            console.log("long shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        shortShuffle() {
            console.log("short shuffle started.")
            this.dlists.sort((a, b) => {
                return new Date(a.vtime) - new Date(b.vtime)
            })
            console.log("short shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        recentShuffle() {
            console.log("recent shuffle started.")
            this.dlists.sort((a, b) => {
                return new Date(b.updatetime) - new Date(a.updatetime)
            })
            console.log("recent shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        watchedShuffle() {
            console.log("recent shuffle started.")
            this.resultCount = 0
            const temp = []
            for(let i=0;i<this.dlists.length;i++) {
                if (this.dlists[i].createtime != this.dlists[i].updatetime) {
                    ++this.resultCount
                    temp.push(this.dlists[i])
                }
            }
            this.dlists = temp
            this.dlists.sort((a, b) => {
                return new Date(b.updatetime) - new Date(a.updatetime)
            })
            console.log("recent shuffle done.")
            this.showoffset = 0;
            this.updateVisual()
        },
        filterByTag(tagname) {
            console.log(`filter by tag ${tagname}`)
            this.resultCount = 0
            this.showoffset = 0
            const temp = []
            for(let i=0;i<this.dlists.length;i++) {
                if (this.dlists[i].tags.indexOf(tagname) != -1) {
                    ++this.resultCount
                    temp.push(this.dlists[i])
                }
            }
            this.dlists = temp
            this.dlists.sort((a, b) => {
                return new Date(b.updatetime) - new Date(a.updatetime)
            })
            console.log("filter by tag done.")
            this.updateVisual()
        },
        filterAllByTag(tagname) {
            this.dlists = this.alists
            this.filterByTag(tagname)
        },
        async addVideoTag(index) {
            const videoId = this.vlists[index].id
            let newTagValue = (this.pageInputs.tagInputs[index].value || "").trim()
            this.pageInputs.tagInputs[index].value = ""
            console.log(`add video tag ${index} ${videoId} ${newTagValue}`)

            if (newTagValue == "" || newTagValue == "-" || newTagValue.length < 2) {
                console.log("ignore empty value")
                return
            }

            if (newTagValue.startsWith("-")) {
                newTagValue = newTagValue.substring(1)
                if (this.vlists[index].tags.indexOf(newTagValue) == -1) {
                    console.log("ignore non-existing value")
                    return
                }

                try {
                    await sendPost("/remove_tag", {
                        id: videoId,
                        tag: newTagValue
                    })
                    let aIdx = this.vlists[index].tags.indexOf(newTagValue)
                    this.vlists[index].tags.splice(aIdx, 1)
                    this.generateAllTags()
                } catch (e) {
                    console.log(e)
                    console.log(`remote failed to add tag: ${newTagValue}`)
                }
            } else {
                if (this.vlists[index].tags.indexOf(newTagValue) != -1) {
                    console.log("ignore existing value")
                    return
                }

                try {
                    await sendPost("/add_tag", {
                        id: videoId,
                        tag: newTagValue
                    })
                    this.vlists[index].tags.push(newTagValue)
                    this.generateAllTags()
                } catch (e) {
                    console.log(e)
                    console.log(`remote failed to add tag: ${newTagValue}`)
                }
            }
        },
        async addFav(id) {
            console.log(`add fav ${id}`)
            if (this.favset.has(id)) {
                console.log(`ignore existing fav: ${id}`)
                return
            }
            try {
                await sendPost("/add_fav", {
                    ticket: this.currentTicket,
                    id
                }, 'json')
                this.favset.add(id)
                this.favset = new Set(this.favset)
            } catch (e) {
                console.log(e)
            }
        },
        async removeFav(id) {
            console.log(`remove fav ${id}`)
            if (!this.favset.has(id)) {
                console.log(`ignore non-existing fav: ${id}`)
                return
            }
            try {
                await sendPost("/remove_fav", {
                    ticket: this.currentTicket,
                    id
                })
                this.favset.delete(id)
                this.favset = new Set(this.favset)
            } catch (e) {
                console.log(e)
            }
        },
        goPrevPage() {
            console.log("prev page.")
            this.stopVideo()
            if (this.showoffset > 0) {
                this.showoffset -= this.showsize
                if(this.showoffset < 1) {
                    this.showoffset = 0
                }
                console.log(this.showoffset, this.showsize)
                this.updateVisual()
            }
        },
        goNextPage() {
            console.log("next page.")
            this.stopVideo()
            if(this.showoffset + this.showsize < this.dlists.length) {
                this.showoffset += this.showsize
                console.log(this.showoffset, this.showsize)
                this.updateVisual()
            }
        },
        search() {
            console.log(`search: kw=${this.keyword} after=${this.afterdate}`)
            this.stopVideo()
            if(this.keyword.length<1 && this.afterdate==null) {
                this.clearSearch()
            } else {
                this.resultCount = 0
                this.showoffset = 0
                let temp = []
                for(let i=0;i<this.dlists.length;i++) {
                    if(this.dlists[i].fname.toLowerCase().indexOf(this.keyword.toLowerCase())!=-1 && (!this.afterdate || new Date(this.dlists[i].mtime) -new Date(this.afterdate)>=0) ) {
                        ++this.resultCount
                        temp.push(this.dlists[i])
                    }
                }
                this.dlists = temp
                this.updateVisual()
            }
            console.log(`Total=${this.resultCount}`)
        },
        async webSearch() {
            console.log(`web search: kw=${this.keyword}`)
            this.stopVideo()
            if(this.keyword.length < 1) {
                console.log(`no keyword specified, skipped.`)
                return
            }
            const searchResult = await sendGet(`/search?kw=${this.keyword}`, 'json')
            console.log(searchResult)

            const currentMap = new Map()
            this.dlists.forEach((info) => {
                currentMap.set(info.id, info)
            })

            this.resultCount=0
            this.showoffset=0
            const temp = []
            searchResult.forEach((vid) => {
                if(currentMap.has(vid)) {
                    temp.push(currentMap.get(vid))
                }
            })
            this.dlists = temp
            this.updateVisual()
            console.log(`Total=${this.resultCount}`)
        },
        async getRecommend(id) {
            console.log(`recommend: ${id}`)
            const searchResult = await sendGet(`/recommend?from=${id}`, 'json')
            console.log(searchResult)

            const currentMap = new Map()
            this.alists.forEach((info) => {
                currentMap.set(info.id, info)
            })

            const temp = []
            searchResult.forEach((vid) => {
                if(currentMap.has(vid)) {
                    temp.push(currentMap.get(vid))
                }
            })
            this.playingRecommends = temp
        },
        clearAndSearch() {
            this.stopVideo()
            this.resultCount=-1
            this.showoffset = 0
            this.dlists = this.alists

            this.search()
        },
        clearAndWebSearch() {
            this.stopVideo()
            this.resultCount=-1
            this.showoffset = 0
            this.dlists = this.alists

            this.webSearch()
        },
        clearSearch() {
            this.stopVideo()
            this.keyword=''
            this.resultCount=-1
            this.afterdate=null
            this.showoffset = 0

            this.dlists = this.alists
            this.updateVisual()
        },
        changePlayRate(rate) {
            console.log(`Playback rate changed to ${rate}`)
            document.getElementById("video_playing").playbackRate=rate
        },
        generateAllTags() {
            console.log("generate tags (browser may freeze)")
            const perfBeginTime = new Date()

            const temp = new Map()
            this.alists.forEach((info) => {
                info.tags.forEach((tagname) => {
                    if(temp.has(tagname)) {
                        temp.set(tagname, temp.get(tagname) + 1)
                    } else {
                        temp.set(tagname, 1)
                    }
                })
            })
            this.alltags = Array.from(temp.keys()).map((key) => ({
                tag: key,
                count: temp.get(key)
            })).sort((a, b) => {
                if(a.tag.toLowerCase() < b.tag.toLowerCase()) return -1
                else if(a.tag.toLowerCase() > b.tag.toLowerCase()) return 1
                else return 0
            })

            console.log(`generate tag finished in ${new Date() - perfBeginTime}ms`)
        },
        async watchedShuffleOnline() {
            console.log("recent shuffle online started.")
            await this.reloadVideoList()
            this.showoffset = 0

            try {
                let data = await sendPost("/history", {
                    ticket: this.currentTicket,
                }, 'json')

                const tempList = []
                data.forEach((info) => {
                    for(let i=0; i<this.alists.length; i++) {
                        if (this.alists[i].id == info.id) {
                            tempList.push(this.alists[i])
                            break;
                        }
                    }
                })
                this.dlists = tempList
                this.updateVisual()
            } catch (e) {
                console.log(e)
            }
        },
        async reloadUserFav() {
            console.log('fetch user fav')

            try {
                const data = await sendPost("/favorites", {
                    ticket: this.currentTicket,
                }, 'json')

                this.favset = new Set(data)
                console.log(`fav list fetched, size=${this.favset.size}`)
            } catch (e) {
                console.log(e)
            }
        },
        async favShuffleOnline() {
            console.log("fav shuffle online started")
            await this.reloadVideoList()
            this.showoffset = 0

            await this.reloadUserFav()
            const tempList = []
            data.forEach((favid) => {
                for(let i=0; i<this.alists.length; i++) {
                    if (this.alists[i].id == favid) {
                        tempList.push(this.alists[i])
                        break;
                    }
                }
            })
            this.dlists = tempList
            this.updateVisual()
        },
        async register() {
            if (!this.inputUsername || this.inputUsername.length < 1 || !this.inputPassword || this.inputPassword.length < 1) {
                this.loginMessage = "请输入用户名和密码!"
                return
            }
            this.loginInProgress = true
            this.loginMessage = "正在注册..."
            try {
                const data = await sendPost("/register", {
                    "username": this.inputUsername,
                    "password": await sha256(this.inputPassword),
                }, 'json')

                console.log(data)

                if (data.code != 0) {
                    throw new Error(data.message)
                }

                this.loginMessage = ""

                this.inputUsername = ""
                this.inputPassword = ""
                this.currentUsername = data.username
                this.currentTicket = data.ticket
                localStorage.setItem("xvcache_username", this.currentUsername)
                localStorage.setItem("xvcache_ticket", this.currentTicket)
            } catch (e) {
                console.log(e)
                this.loginMessage = `注册失败 ${e.toString()}`
            } finally {
                this.loginInProgress = false
            }
        },
        async login() {
            if (!this.inputUsername || this.inputUsername.length < 1 || !this.inputPassword || this.inputPassword.length < 1) {
                this.loginMessage = "请输入用户名和密码!"
                return
            }
            this.loginInProgress = true
            this.loginMessage = "正在登录..."
            try {
                const data = await sendPost("/login", {
                    "username": this.inputUsername,
                    "password": await sha256(this.inputPassword),
                }, 'json')

                console.log(data)

                if (data.code != 0) {
                    throw new Error(data.message)
                }

                this.loginMessage = ""

                this.inputUsername = ""
                this.inputPassword = ""
                this.currentUsername = data.username
                this.currentTicket = data.ticket
                localStorage.setItem("xvcache_username", this.currentUsername)
                localStorage.setItem("xvcache_ticket", this.currentTicket)
            } catch (e) {
                console.log(e)
                this.loginMessage = `登录失败! ${e.toString()}`
            } finally {
                this.loginInProgress = false
            }
        },
        logout() {
            this.currentUsername = ""
            this.currentTicket = ""
            localStorage.removeItem("xvcache_username")
            localStorage.removeItem("xvcache_ticket")
            this.loginMessage = ""
        }
    }
}).mount('#app')


app.initPanel()

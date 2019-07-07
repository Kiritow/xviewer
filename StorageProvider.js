const fs = require('fs')
const path = require('path')
const RemoteFSClient = require("./remotefs")


class StorageProvider {
    constructor(localDirList, remotefsInfoList) {
        this.fileMap = new Map()
        this.localDirList = localDirList
        this.remotefsInfoList = remotefsInfoList
    }

    async init() {
        let pArr = new Array()
        this.localDirList.forEach((localDir) => {
            console.log(`LocalDir: ${localDir}`)
            pArr.push(new Promise((resolve, reject)=>{
                fs.readdir(localDir, (err, files) => {
                    if(err) {
                        return reject(err)
                    }
                    files.forEach((fname) => {
                        if(!this.fileMap.has(fname)) {
                            this.fileMap.set(fname, [])
                        }
                        this.fileMap.get(fname).push({
                            type: "local",
                            dir: localDir
                        })
                    })
                    return resolve()
                })
            }))
        })

        let remoteFsList = new Array()
        this.remotefsInfoList.forEach((config)=>{
            console.log(`RemoteFS: ${config.name}`)
            remoteFsList.push(new RemoteFSClient(config.name, config.skey))
        })

        remoteFsList.forEach((remoteFS)=>{
            pArr.push((async (client)=>{
                let files = JSON.parse(await client.getList())
                files.forEach((fname)=>{
                    if(!this.fileMap.has(fname)) {
                        this.fileMap.set(fname, [])
                    }
                    this.fileMap.get(fname).push({
                        type: "remotefs",
                        client: client
                    })
                })
            })(remoteFS))
        })

        return Promise.all(pArr)
    }

    locateFile(filename) {
        let lst = this.fileMap.get(filename)
        return lst ? lst : null
    }

    getFileStream(filename, range) {
        let filePosition = this.locateFile(filename)
        if (filePosition == null) {
            throw Error(`File ${filename} not found.`)
        }

        let decidedLocalInfo = null
        let decidedRemoteInfo = null

        // Find type=local first...
        filePosition.forEach((info) => {
            if (info.type == "local") {
                decidedLocalInfo = info
            } else if(info.type == "remotefs") {
                decidedRemoteInfo = info
            }
        })

        if (decidedLocalInfo != null) {
            if(range) {
                return fs.createReadStream(path.join(decidedLocalInfo.dir, filename), {start: range.start, end: range.end})
            } else {
                return fs.createReadStream(path.join(decidedLocalInfo.dir, filename))
            }
        }

        if (decidedRemoteInfo != null) {
            return decidedRemoteInfo.client.getFileStream(filename, range)
        }

        throw Error(`File ${filename} not found. Should not reach here.`)
    }
}

module.exports = StorageProvider

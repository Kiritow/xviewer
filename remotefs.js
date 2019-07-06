const request=require('request')
const url=require('url')

class RemoteFSClient {
    constructor(remotefs_link, app_key) {
        this.remotefs_link = remotefs_link
        this.app_key = app_key
    }

    getInfo() {
        return new Promise((resolve, reject)=>{
            request(this.remotefs_link, (err, res, body) => {
                if (err) {
                    return reject(err)
                } else {
                    return resolve(body)
                }
            })
        })
    }

    getList() {
        return new Promise((resolve, reject)=>{
            request({
                url: url.resolve(this.remotefs_link, "list"),
                method: "POST",
                body: JSON.stringify({
                    skey: this.app_key
                })
            }, (err, res, body) => {
                if(err) {
                    return reject(err)
                } else {
                    return resolve(body)
                }
            })
        })
    }

    getFile(filename) {
        return new Promise((resolve, reject)=>{
            request({
                url: url.resolve(this.remotefs_link, "getfile"),
                method: "POST",
                body: JSON.stringify({
                    name: filename,
                    skey: this.app_key
                })
            }, (err, res, body) => {
                if(err) {
                    return reject(err)
                }
                if(res.statusCode == 200) {
                    return resolve(body)
                } else {
                    try {
                        let j = JSON.parse(body)
                        j.statusCode = res.statusCode
                        return reject(j)
                    } catch (e) {
                        return reject(e)
                    }
                }
            })
        })
    }

    getFileStream(filename, range) {
        return request({
            url: url.resolve(this.remotefs_link, "getfile"),
            method: "POST",
            body: JSON.stringify({
                name: filename,
                skey: this.app_key,
                range: range
            })
        })
    }
}

module.exports = RemoteFSClient

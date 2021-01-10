class Database {
    constructor(implProvider) {
        this.proxy=implProvider
    }

    close() {
        return this.proxy.close()
    }

    getProxy() {
        return this.proxy
    }

    // All following methods must return Promise.
    async getObject(objID) {
        return this.proxy.getObject(objID)
    }

    async getObjectIDs() {
        return this.proxy.getObjectIDs()
    }

    async getVideoObjects() {
        return this.proxy.getVideoObjects()
    }

    async addVideoWatchByID(objID) {
        return this.proxy.addVideoWatchByID(objID)
    }

    async addVideoWatchHistory(username, remoteIP, objID) {
        return this.proxy.addVideoWatchHistory(username, remoteIP, objID)
    }
    
    async addVideoTag(objID, value) {
        return this.proxy.addVideoTag(objID, value)
    }

    async removeVideoTag(objID, value) {
        return this.proxy.removeVideoTag(objID, value)
    }

    async getRecentByUser(username) {
        return this.proxy.getRecentByUser(username)
    }
}

module.exports=Database

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

    async addVideoWatchHistory(ticket, remoteIP, objID) {
        return this.proxy.addVideoWatchHistory(ticket, remoteIP, objID)
    }
    
    async addVideoTag(objID, value) {
        return this.proxy.addVideoTag(objID, value)
    }

    async removeVideoTag(objID, value) {
        return this.proxy.removeVideoTag(objID, value)
    }

    async getHistoryByTicket(ticket) {
        return this.proxy.getHistoryByTicket(ticket)
    }

    async loginUser(username, passhash) {
        return this.proxy.loginUser(username, passhash)
    }

    async addUser(username, passhash) {
        return this.proxy.addUser(username, passhash)
    }
}

module.exports=Database

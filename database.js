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
    async isTableExists(tableName) {
        return this.proxy.isTableExists(tableName)
    }

    async createTables() {
        return this.proxy.createTables()
    }

    async addObject(objID,objName,objMtime,objSize) {
        return this.proxy.addObject(objID,objName,objMtime,objSize)
    }

    async addVideoObject(objID,objName,objMtime,objSize,uploader,tags,coverID) {
        return this.proxy.addVideoObject(objID,objName,objMtime,objSize,uploader,tags,coverID)
    }

    async getObject(objID) {
        return this.proxy.getObject(objID)
    }

    async getVideoObjects() {
        return this.proxy.getVideoObjects()
    }

    async addVideoWatchByID(objID) {
        return this.proxy.addVideoWatchByID(objID)
    }
}

module.exports=Database
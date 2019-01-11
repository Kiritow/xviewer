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

    async createTable(tableName,ddl) {
        return this.proxy.createTable(tableName,ddl)
    }

    async addObject(objID,objName) {
        return this.proxy.addObject(objID,objName)
    }

    async getObject(objID) {
        return this.proxy.getObject(objID)
    }
}

module.exports=Database
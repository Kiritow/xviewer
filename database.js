class Database {
    constructor(implProvider) {
        this.proxy=implProvider
    }

    getProxy() {
        return this.proxy
    }

    query() {
        return this.proxy(...arguments)
    }

    exec() {
        return this.proxy(...arguments,)
    }
}

module.exports=Database
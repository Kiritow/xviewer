const mysql = require('mysql');

class BaseConnection {
    /**
     *
     * @param {mysql.PoolConnection} mysqlConn
     */
    constructor(mysqlConn, logger) {
        this.conn = mysqlConn;
        this.logger = logger;
    }

    async begin() {
        return new Promise((resolve, reject) => {
            if (this.logger) this.logger.debug('begin');
            this.conn.beginTransaction((err) => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    }

    async rollback() {
        return new Promise((resolve, reject) => {
            if (this.logger) this.logger.debug('rollback');
            this.conn.rollback((e) => {
                if (e) {
                    return reject(e);
                }

                return resolve();
            });
        });
    }

    async commit() {
        return new Promise((resolve, reject) => {
            if (this.logger) this.logger.debug('commit');
            this.conn.commit((e) => {
                if (e) {
                    return reject(e);
                }

                return resolve();
            });
        });
    }

    async queryEx(sql, params) {
        if (this.logger) this.logger.debug(sql, params);
        return new Promise((resolve, reject) => {
            this.conn.query(sql, params, (err, results, fields) => {
                if (err) {
                    return reject(err);
                }

                return resolve({ results, fields });
            });
        });
    }

    async query(sql, params) {
        return (await this.queryEx(sql, params)).results;
    }

    release() {
        this.conn.release();
    }

    close() {
        this.conn.destroy();
    }
}

class BaseDaoClass {
    constructor(mysqlOptions, logger) {
        this.pool = mysql.createPool(mysqlOptions);
        this.logger = logger;
    }

    // Utils
    async queryEx(sql, params) {
        if (this.logger) this.logger.debug(sql, params);
        return new Promise((resolve, reject) => {
            this.pool.query(sql, params, (err, results, fields) => {
                if (err) {
                    return reject(err);
                }

                return resolve({ results, fields });
            });
        });
    }

    async query(sql, params) {
        return (await this.queryEx(sql, params)).results;
    }

    // call release or destroy on Connection object later.
    /**
     * @returns {Promise<BaseConnection>}
     */
    async getConnection() {
        return new Promise((resolve, reject) => {
            this.pool.getConnection((err, conn) => {
                if (err) {
                    return reject(err);
                }

                return resolve(new BaseConnection(conn, this.logger));
            });
        });
    }
}

module.exports = {
    BaseConnection, // Mainly used for JSDoc.
    BaseDaoClass,
};

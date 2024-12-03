/* eslint-disable @typescript-eslint/no-unused-vars */
import * as mysql from "mysql2";

export interface QueryOptions {
    disableLogger?: boolean;
    logger?: ILogger;
}

class QueryMethods<TBase extends QueryMethods<TBase>> {
    queryEx<T extends mysql.QueryResult = mysql.RowDataPacket[]>(
        sql: string,
        params: unknown,
        options?: QueryOptions
    ): Promise<{ results: T; fields?: mysql.FieldPacket[] }> {
        throw new Error("Method not implemented.");
    }

    async query<T extends mysql.QueryResult = mysql.RowDataPacket[]>(
        sql: string,
        params: unknown,
        options?: QueryOptions
    ) {
        return (await this.queryEx<T>(sql, params, options)).results;
    }

    async run<T extends mysql.QueryResult = mysql.ResultSetHeader>(
        sql: string,
        params: unknown,
        options?: QueryOptions
    ) {
        return (await this.queryEx<T>(sql, params, options)).results;
    }

    async insert(
        table: string,
        data: Record<string, unknown>
    ): Promise<mysql.ResultSetHeader> {
        const keys = Object.keys(data);
        const sqlValuesPart = new Array(keys.length).fill("?").join(",");

        const sql = `INSERT INTO ${table}(${keys.join(",")}) VALUES(${sqlValuesPart})`;
        const params = keys.map((key) => data[key]);

        return this.run(sql, params);
    }

    async insertIgnore(
        table: string,
        data: Record<string, unknown>
    ): Promise<mysql.ResultSetHeader> {
        const keys = Object.keys(data);
        const sqlValuesPart = new Array(keys.length).fill("?").join(",");

        const sql = `INSERT IGNORE INTO ${table}(${keys.join(",")}) VALUES(${sqlValuesPart})`;
        const params = keys.map((key) => data[key]);

        return this.run(sql, params);
    }

    async upsert(
        table: string,
        data: Record<string, unknown>,
        upsertKeys: string[],
        updateTimeFieldName?: string // force update `updateTimeField` to now()
    ): Promise<mysql.ResultSetHeader> {
        const keys = Object.keys(data);
        const sqlValuesPart = new Array(keys.length).fill("?").join(",");
        let sqlUpdatePart = upsertKeys
            .map((key) => `${key}=VALUES(${key})`)
            .join(",");
        if (updateTimeFieldName !== undefined) {
            if (upsertKeys.length > 0) {
                sqlUpdatePart += `,${updateTimeFieldName}=NOW()`;
            } else {
                sqlUpdatePart = `${updateTimeFieldName}=NOW()`;
            }
        }

        const sql = `insert into ${table}(${keys.join(",")}) values(${sqlValuesPart}) on duplicate key update ${sqlUpdatePart}`;
        const params = keys.map((key) => data[key]);

        return this.run(sql, params);
    }
}

export interface ILogger {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debug: (...args: any[]) => void;
}

export class BaseConnection extends QueryMethods<BaseConnection> {
    conn: mysql.PoolConnection;
    logger?: ILogger;

    constructor(mysqlConn: mysql.PoolConnection, logger?: ILogger) {
        super();
        this.conn = mysqlConn;
        this.logger = logger;
    }

    begin(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.logger) {
                this.logger.debug("begin transaction");
            }

            this.conn.beginTransaction((err) => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    }

    beginReadonly(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.logger) {
                this.logger.debug("begin transaction read only");
            }
            this.conn.query("START TRANSACTION READ ONLY", (err) => {
                if (err) {
                    return reject(err);
                }

                return resolve();
            });
        });
    }

    rollback(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.logger) {
                this.logger.debug("rollback transaction");
            }
            this.conn.rollback((e) => {
                if (e) {
                    return reject(e);
                }

                return resolve();
            });
        });
    }

    commit(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.logger) {
                this.logger.debug("commit transaction");
            }
            this.conn.commit((e) => {
                if (e) {
                    return reject(e);
                }

                return resolve();
            });
        });
    }

    async queryEx<T extends mysql.QueryResult = mysql.RowDataPacket[]>(
        sql: string,
        params: unknown,
        options?: QueryOptions
    ): Promise<{ results: T; fields?: mysql.FieldPacket[] }> {
        return new Promise((resolve, reject) => {
            if (options?.disableLogger !== true) {
                (options?.logger || this.logger)?.debug(sql, params);
            }

            this.conn.query<T>(sql, params, (err, results, fields) => {
                if (err) {
                    return reject(err);
                }

                return resolve({ results, fields });
            });
        });
    }

    release() {
        this.conn.release();
    }

    close() {
        this.conn.destroy();
    }
}

export class BaseDaoClass extends QueryMethods<BaseConnection> {
    pool: mysql.Pool;
    logger?: ILogger;

    constructor(mysqlOptions: mysql.PoolOptions, logger?: ILogger) {
        super();
        this.pool = mysql.createPool(mysqlOptions);
        this.logger = logger;
    }

    // Utils
    async queryEx<T extends mysql.QueryResult = mysql.RowDataPacket[]>(
        sql: string,
        params: unknown,
        options?: QueryOptions
    ): Promise<{
        results: T;
        fields?: mysql.FieldPacket[];
    }> {
        return new Promise((resolve, reject) => {
            if (options?.disableLogger !== true) {
                (options?.logger || this.logger)?.debug(sql, params);
            }

            this.pool.query<T>(sql, params, (err, results, fields) => {
                if (err) {
                    return reject(err);
                }

                return resolve({ results, fields });
            });
        });
    }

    // call release or destroy on Connection object later.
    async getConnection(): Promise<BaseConnection> {
        return new Promise((resolve, reject) => {
            this.pool.getConnection((err, conn) => {
                if (err) {
                    return reject(err);
                }

                return resolve(new BaseConnection(conn));
            });
        });
    }
}

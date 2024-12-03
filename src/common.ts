import { Client as ESClient } from "@elastic/elasticsearch";
import { DaoClass } from "./dao";
import getOrCreateLogger from "./base-log";

const ES_HOST = process.env.ES_HOST;
const ES_PORT = parseInt(process.env.ES_PORT || "9200", 10);

export const dao = new DaoClass(
    {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || "3306", 10),
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
    },
    getOrCreateLogger("dao", { level: "debug" })
);

export const esClient = new ESClient({
    node: `http://${ES_HOST}:${ES_PORT}`,
});

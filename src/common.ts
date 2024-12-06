import { Client as ESClient } from "@elastic/elasticsearch";
import { DaoClass } from "./dao";
import getOrCreateLogger from "./base-log";
import { GetMySQLOptions } from "./configs";
import { AdminDaoClass } from "./dao-admin";

const ES_HOST = process.env.ES_HOST;
const ES_PORT = parseInt(process.env.ES_PORT || "9200", 10);

export const dao = new DaoClass(
    GetMySQLOptions(),
    getOrCreateLogger("dao", { level: "debug" })
);

export const adminDao = new AdminDaoClass(
    GetMySQLOptions(),
    getOrCreateLogger("admin-dao", { level: "debug" })
);

export const esClient = new ESClient({
    node: `http://${ES_HOST}:${ES_PORT}`,
});

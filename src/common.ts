import { Client as ESClient } from "@elastic/elasticsearch";
import { DaoClass } from "./dao";
import getOrCreateLogger from "./base-log";
import { GetAppConfig } from "./configs";
import { AdminDaoClass } from "./dao-admin";

export const dao = new DaoClass(
    GetAppConfig().mysql,
    getOrCreateLogger("dao", { level: "debug" })
);

export const adminDao = new AdminDaoClass(
    GetAppConfig().mysql,
    getOrCreateLogger("admin-dao", { level: "debug" })
);

export const esClient = new ESClient({
    node: `http://${GetAppConfig().es.host}:${GetAppConfig().es.port}`,
});

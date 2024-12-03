import path from "path";
import fs from "fs";
import { VideoObjectInfo } from "./models";
import { SearchResponse } from "@elastic/elasticsearch/api/types";
import { dao, esClient } from "./common";
import getOrCreateLogger from "./base-log";

const logger = getOrCreateLogger("utils", { level: "debug" });

const ROOT_DIR = process.env.ROOT_DIR || "/data";
const ES_INDEX = process.env.ES_INDEX;

export function GetHeatFromInfo(info: VideoObjectInfo, progressRatio: number) {
    const now = Date.now();

    let heat = 0;
    if (now - info.createtime.getTime() < 1000 * 60 * 60 * 24 * 30) {
        heat += 200;
    } else if (now - info.createtime.getTime() < 1000 * 60 * 60 * 24 * 90) {
        heat += 150;
    } else if (now - info.createtime.getTime() < 1000 * 60 * 60 * 24 * 180) {
        heat += 100;
    } else if (now - info.createtime.getTime() < 1000 * 60 * 60 * 24 * 365) {
        heat += 50;
    }

    if (info.watchcount < 1) {
        heat -= 190;
    } else if (info.watchcount < 5) {
        heat += 15 * info.watchcount * progressRatio;
    } else if (info.watchcount < 10) {
        heat += (65 + (info.watchcount - 5) * 35) * progressRatio;
    } else if (info.watchcount < 100) {
        heat += (240 + (info.watchcount - 10) * 30) * progressRatio;
    } else {
        heat += (2940 + (info.watchcount - 100) * 10) * progressRatio;
    }

    return heat;
}

export function isObjectExists(objectId: string) {
    const prefix = objectId.substring(0, 2);
    const resourcePath = `${prefix}/${objectId}`;
    const filePath = path.join(ROOT_DIR, "objects", resourcePath);

    return new Promise((resolve) => {
        fs.access(filePath, fs.constants.R_OK, (err) =>
            resolve(err ? false : true)
        );
    });
}

interface ESDataType {
    name: string;
    vid: string;
}

export async function ESSimpleSearch(keyword: string, size: number) {
    const result = await esClient.search<SearchResponse<ESDataType>>({
        index: ES_INDEX,
        size,
        body: {
            query: {
                match: {
                    name: keyword,
                },
            },
        },
    });

    logger.debug(result.body);
    return result.body.hits.hits;
}

export async function PreReadObjectList() {
    const objLst = await dao.getAllObjectID();
    let cntFailed = 0;
    await Promise.all(
        objLst.map(async (objId) => {
            if (!(await isObjectExists(objId))) {
                ++cntFailed;
                logger.info(`[WARN] object ${objId} not found on disk`);
            }
        })
    );

    logger.warn(
        `${objLst.length} objects checked. ${cntFailed} objects not found.`
    );
}

import path from "node:path";
import fs from "node:fs";
import z from "zod";
import { VideoObjectInfo } from "./models";
import { SearchResponse } from "@elastic/elasticsearch/api/types";
import { dao, esClient } from "./common";
import getOrCreateLogger from "./base-log";
import { GetAppConfig } from "./configs";

const logger = getOrCreateLogger("utils", { level: "debug" });

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

export function paginationToLimitOffset(
    defaultLimit: number,
    page?: number,
    size?: number
): { limit: number; offset: number } {
    const usePage = page ?? 1;
    const useSize = size ?? defaultLimit;

    return {
        limit: useSize,
        offset: (usePage - 1) * useSize,
    };
}

export function readableZodError<T>(err: z.ZodError<T>): string {
    return err.errors
        .map((e) => {
            const readablePath = e.path
                .map((p) => {
                    if (typeof p === "number") {
                        return `[${p}]`;
                    }
                    return `.${p}`;
                })
                .join("")
                .substring(1);
            return `${readablePath}: ${e.message}`;
        })
        .join("; ");
}

export function isTrue(val: string | number | boolean): boolean {
    if (typeof val === "boolean") return val;
    if (typeof val === "number") return val !== 0;
    const s = val.toLowerCase().trim();
    switch (s) {
        case "1":
        case "enable":
        case "true":
        case "yes":
        case "on":
            return true;
        case "0":
        case "disable":
        case "false":
        case "no":
        case "off":
            return false;
        default:
            throw new Error(`invalid boolean string: ${val}`);
    }
}

async function getObjectPath(objID: string) {
    for (const rootDirConfig of GetAppConfig().rootDirs) {
        const prefix = objID.substring(0, 2);
        const resourcePath = `${prefix}/${objID}`;
        const filePath = path.join(rootDirConfig.path, "objects", resourcePath);

        try {
            await fs.promises.access(filePath, fs.constants.R_OK);
            return {
                rootPath: rootDirConfig.path,
                urlPrefix: rootDirConfig.urlPrefix,
                filePath,
            };
        } catch (err) {
            // continue to next root path
        }
    }

    return undefined;
}

interface ESDataType {
    name: string;
    vid: string;
}

export async function ESSimpleSearch(keyword: string, size: number) {
    const result = await esClient.search<SearchResponse<ESDataType>>({
        index: GetAppConfig().es.index,
        size,
        body: {
            query: {
                match: {
                    name: keyword,
                },
            },
        },
    });

    // logger.debug(result.body);
    return result.body.hits.hits;
}

const _objectPathCache = new Map<
    string,
    { rootPath: string; filePath: string; urlPrefix: string }
>();

async function getObjectPathWithCache(objID: string) {
    let objectPath = _objectPathCache.get(objID);
    if (objectPath !== undefined) {
        return objectPath;
    }

    objectPath = await getObjectPath(objID);
    if (objectPath !== undefined) {
        _objectPathCache.set(objID, objectPath);
    }

    return objectPath;
}

export async function PreReadObjectList() {
    const objList = await dao.getAllObjectID();
    console.log(`${objList.length} objects loaded from db`);

    let cntFailed = 0;
    for (let i = 0; i < objList.length; ++i) {
        const objPath = await getObjectPathWithCache(objList[i]);
        if (objPath === undefined) {
            ++cntFailed;
            logger.info(`[WARN] object ${objList[i]} not found on disk`);
        }

        if (i % 1000 === 0) {
            logger.info(`${i} of ${objList.length} objects checked`);
        }
    }

    logger.warn(
        `${objList.length} objects checked. ${cntFailed} objects not found.`
    );
}

export async function GetVideoObjectUrl(objID: string) {
    const objectPath = await getObjectPathWithCache(objID);
    if (objectPath === undefined) {
        return undefined;
    }

    const url = new URL(
        `/video/${objID.substring(0, 2)}/${objID}`,
        objectPath.urlPrefix
    );
    return url.href;
}

export async function GetImageObjectUrl(objID: string) {
    const objectPath = await getObjectPathWithCache(objID);
    if (objectPath === undefined) {
        return undefined;
    }

    const url = new URL(
        `/image/${objID.substring(0, 2)}/${objID}`,
        objectPath.urlPrefix
    );
    return url.href;
}

export async function GetTranscodeObjectUrl(objID: string) {
    const objectPath = await getObjectPathWithCache(objID);
    if (objectPath === undefined) {
        return undefined;
    }

    const url = new URL(`/transcode/${objID}`, objectPath.urlPrefix);
    return url.href;
}

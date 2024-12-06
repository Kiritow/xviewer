import crypto from "crypto";
import { BaseDaoClass } from "./base-dao";
import {
    _objectSchema,
    _videoObjectSchema,
    _videoTranscodeSchema,
    _videoWatchStatSchema,
} from "./models";
import { z } from "zod";

export class AdminDaoClass extends BaseDaoClass {
    async addObject(id: string, filename: string, fsize: number, mtime: Date) {
        await this.insert("objects", {
            id,
            filename,
            mtime,
            fsize,
        });
    }

    async addVideo(
        id: string,
        filename: string,
        fsize: number,
        mtime: Date,
        coverid: string,
        duration: number,
        tags: string[]
    ) {
        const conn = await this.getConnection();
        try {
            await conn.begin();
            await conn.insert("objects", {
                id,
                filename,
                mtime,
                fsize,
            });
            await conn.insert("videos", {
                id,
                coverid,
                videotime: duration,
                tags: JSON.stringify(tags),
            });
            await conn.commit();
        } catch (e) {
            console.log(e);

            await conn.rollback();
        } finally {
            conn.release();
        }
    }
}

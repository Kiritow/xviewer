import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import assert from "assert";
import path from "path";
import fs from "fs";
import { dao, adminDao } from "./common";
import { ObjectInfo } from "./models";

function RunCommand(command: string, args?: string[]): Promise<string> {
    let stdout = "";

    const child = spawn(command, args);
    child.stdout.on("data", (data) => {
        if (data instanceof Buffer) {
            stdout += data.toString();
        } else {
            stdout += data;
        }
    });
    child.stderr.on("data", (data) => {
        console.error(data instanceof Buffer ? data.toString() : data);
    });

    return new Promise((resolve, reject) => {
        child.on("close", (code) => {
            if (code !== 0) {
                return reject(
                    new Error(`Command ${command} failed with code: ${code}`)
                );
            }
            return resolve(stdout);
        });
    });
}

async function GetFileHash(fullpath: string): Promise<string> {
    console.log(`GetFileHash: ${fullpath}`);
    const result = await RunCommand("sha256sum", [fullpath]);
    return result.trim().split(" ")[0];
}

async function GenerateCover(
    videoFullpath: string,
    outputDirPath: string
): Promise<string> {
    const coverPath = `${outputDirPath}/${uuidv4()}.png`;
    console.log(`GenerateCover: ${videoFullpath} -> ${coverPath}`);

    await RunCommand("ffmpeg", [
        "-ss",
        "00:00:05.000",
        "-i",
        videoFullpath,
        "-vframes",
        "1",
        coverPath,
    ]);

    return coverPath;
}

async function GetFileStat(fullpath: string) {
    const stat = await fs.promises.stat(fullpath);

    return {
        mtime: stat.mtime,
        size: stat.size,
    };
}

async function GetVideoStat(videoFullpath: string) {
    const result = await RunCommand("ffprobe", [
        "-i",
        videoFullpath,
        "-show_entries",
        "format=duration",
        "-v",
        "quiet",
        "-of",
        "csv=p=0",
    ]);
    const duration = parseInt(result.trim(), 10);
    if (isNaN(duration)) {
        throw new Error(`ffprobe failed to get video length`);
    }

    return {
        duration,
    };
}

export class VideoManager {
    private objectMap: Map<string, ObjectInfo>;
    private tempDir: string;
    private objDir: string;
    private pendingDir: string;

    constructor(tempDir: string, objDir: string, pendingDir: string) {
        this.objectMap = new Map();
        this.tempDir = tempDir;
        this.objDir = objDir;
        this.pendingDir = pendingDir;
    }

    async init() {
        this.objectMap.clear();
        const objs = await dao.getObjects();
        objs.forEach((obj) => {
            this.objectMap.set(obj.id, obj);
        });
        console.log(`Loaded ${this.objectMap.size} objects`);
    }

    async renameObject(fullpath: string, id: string) {
        const newPath = `${this.objDir}/${id.substring(0, 2)}/${id}`;
        console.log(`rename: ${fullpath} -> ${newPath}`);
        await fs.promises.rename(fullpath, newPath);
    }

    async addVideo(
        videoFullpath: string,
        tags: string[],
        detectCover?: boolean,
        coverExts?: string[]
    ) {
        const videoDirectory = path.dirname(videoFullpath);
        const videoFilename = path.basename(videoFullpath);
        const videonameWithoutExt = videoFilename
            .split(".")
            .slice(0, -1)
            .join(".");

        const videoHash = await GetFileHash(videoFullpath);
        if (this.objectMap.has(videoHash)) {
            const currentObj = this.objectMap.get(videoHash);
            assert(currentObj !== undefined);
            console.log(
                `Video ${videoFilename} already exists. Record name: ${currentObj.filename} hash: ${videoHash}`
            );
            return false;
        }

        let coverPath: string | undefined = undefined;
        let isNewCover = false;
        if (detectCover) {
            const useExts = coverExts || ["png", "jpg", ".jpeg"];
            for (const ext of useExts) {
                const possibleCoverPath = `${videoDirectory}/${videonameWithoutExt}.${ext}`;
                if (fs.existsSync(possibleCoverPath)) {
                    console.log(`Found cover: ${possibleCoverPath}`);
                    const currentCoverHash =
                        await GetFileHash(possibleCoverPath);
                    if (this.objectMap.has(currentCoverHash)) {
                        console.log(
                            `Cover ${possibleCoverPath} already exists. Record name: ${this.objectMap.get(currentCoverHash)?.filename} hash: ${currentCoverHash}`
                        );
                        isNewCover = false;
                    } else {
                        isNewCover = true;
                    }
                    coverPath = possibleCoverPath;
                    break;
                }
            }
        }

        if (coverPath === undefined) {
            coverPath = await GenerateCover(videoFullpath, this.tempDir);
            isNewCover = true;
        }

        const videoStat = {
            ...(await GetFileStat(videoFullpath)),
            ...(await GetVideoStat(videoFullpath)),
        };

        const coverHash = await GetFileHash(coverPath);
        const coverStat = await GetFileStat(coverPath);

        if (isNewCover) {
            await adminDao.addObject(
                coverHash,
                path.basename(coverPath),
                coverStat.size,
                coverStat.mtime
            );
            await this.renameObject(coverPath, coverHash);
        }

        await adminDao.addVideo(
            videoHash,
            videoFilename,
            videoStat.size,
            videoStat.mtime,
            coverHash,
            videoStat.duration,
            tags
        );
        await this.renameObject(videoFullpath, videoHash);

        return true;
    }

    async scanDir(
        dir: string,
        tags: string[],
        results: { name: string; tags: string[] }[]
    ) {
        const files = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const file of files) {
            const fullpath = `${dir}/${file.name}`;

            if (file.isDirectory()) {
                await this.scanDir(fullpath, [...tags, file.name], results);
                continue;
            }

            if (!file.isFile()) {
                console.log(`Skip non-file ${fullpath}`);
                continue;
            }

            const ext = path.extname(file.name);
            const allowedExts = [
                ".mp4",
                ".mov",
                ".vdat",
                ".wmv",
                ".rmvb",
                ".avi",
            ];
            if (!allowedExts.includes(ext)) {
                console.log(`Skip non-video file ${fullpath}`);
                continue;
            }

            results.push({
                name: fullpath,
                tags,
            });
        }
    }

    async scan(reportProgress: (message: string) => void) {
        const results: { name: string; tags: string[] }[] = [];
        await this.scanDir(this.pendingDir, [], results);

        console.log(results);
        reportProgress(`Found ${results.length} videos`);
        reportProgress(results.map((r) => r.name).join("\n"));

        for (const { name, tags } of results) {
            reportProgress(`Processing ${name}`);
            try {
                await this.init();
                await this.addVideo(name, tags, true);
                reportProgress(`Completed ${name}`);
            } catch (e) {
                console.log(e);
                reportProgress(`Failed to process ${name}`);
            }
        }
    }
}

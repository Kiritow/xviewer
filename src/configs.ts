import fs from "node:fs";
import z from "zod";

const _configFileSchema = z.object({
    koaAppKeys: z.array(z.string()),
    es: z.object({
        host: z.string(),
        port: z.number(),
        index: z.string(),
    }),
    mysql: z.object({
        host: z.string(),
        port: z.number(),
        user: z.string(),
        password: z.string(),
        database: z.string(),
    }),
    rootDirs: z.array(
        z.object({
            path: z.string(),
            urlPrefix: z.string(),
        })
    ),
});

type ConfigFileData = z.infer<typeof _configFileSchema>;

let _cachedConfig: ConfigFileData | undefined = undefined;

export function GetAppConfig() {
    if (_cachedConfig !== undefined) {
        return _cachedConfig;
    }

    _cachedConfig = _configFileSchema.parse(
        JSON.parse(fs.readFileSync("config.json", "utf-8"))
    );
    return _cachedConfig;
}

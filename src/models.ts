import z from "zod";

function zodParseJson(s: string, zctx: z.RefinementCtx) {
    try {
        return JSON.parse(s);
    } catch (e) {
        zctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "invalid JSON",
        });
    }
    return z.NEVER;
}

function zodParseJsonWithDefault(value: unknown) {
    return (s: string, zctx: z.RefinementCtx) => {
        try {
            return JSON.parse(s);
        } catch (e) {
            if (e instanceof SyntaxError) { return value; }
            zctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `error during JSON parsing: ${e instanceof Error ? e.message : e}`,
            });
        }

        return z.NEVER;
    };
}

export const ObjectInfo = z.object({
    id: z.string(),
    filename: z.string(),
});

export type ObjectInfo = z.infer<typeof ObjectInfo>;

export const VideoObjectInfo = z.object({
    id: z.string(),
    coverid: z.string(),
    filename: z.string(),
    mtime: z.number(),
    fsize: z.number(),
    videotime: z.number(),
    watchcount: z.number(),
    vote: z.number(),
    createtime: z.date(),
    updatetime: z.date(),
    tags: z.string().transform(zodParseJsonWithDefault).pipe(z.string().array()),
});

export type VideoObjectInfo = z.infer<typeof VideoObjectInfo>;

export const VideoWatchStat = z.object({
    id: z.string(),
    totaltime: z.number(),
    avgtime: z.number(),
});

export type VideoWatchStat = z.infer<typeof VideoWatchStat>;

export const VideoTranscodeInfo = z.object({
    id: z.string(),
    encname: z.string(),
    watchcount: z.number(),
    createtime: z.date(),
    updatetime: z.date(),
});

export type VideoTranscodeInfo = z.infer<typeof VideoTranscodeInfo>;

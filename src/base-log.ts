import {
    createLogger,
    format,
    transports,
    Logger as WinstonLogger,
} from "winston";
import dayjs from "dayjs";
import path from "path";

const loggerMaps = new Map();

const stackReg = /^(?:\s*)at (?:(.+) \()?(?:([^(]+?):(\d+):(\d+))\)?$/;

function parseError(err: Error, skip: number) {
    try {
        const stacklines = err.stack?.split("\n").slice(skip);
        if (!stacklines?.length) {
            return undefined;
        }

        const lineMatch = stackReg.exec(stacklines[0]);
        if (!lineMatch || lineMatch.length < 5) {
            return undefined;
        }

        let className = "";
        let functionName = "";
        let functionAlias = "";
        if (lineMatch[1] && lineMatch[1] !== "") {
            [functionName, functionAlias] = lineMatch[1]
                .replace(/[[\]]/g, "")
                .split(" as ");
            functionAlias = functionAlias || "";

            if (functionName.includes(".")) {
                [className, functionName] = functionName.split(".");
            }
        }

        return {
            className,
            functionName,
            functionAlias,
            callerName: lineMatch[1] || "",
            fileName: lineMatch[2],
            lineNumber: parseInt(lineMatch[3], 10),
            columnNumber: parseInt(lineMatch[4], 10),
        };
    } catch (e) {
        return undefined;
    }
}

function lineNumber(backtraceLevel: number) {
    const stk = parseError(new Error(), backtraceLevel + 2);
    if (stk === undefined) {
        return "<unknown>";
    }
    return `${path.basename(stk.fileName)}:${stk.lineNumber}`;
}

interface LoggerOptions {
    level: string;
    filename?: string;
    logpath?: string;

    file?: boolean;
    console?: boolean;
}

export class Logger {
    _logger: WinstonLogger;

    constructor(options: LoggerOptions) {
        this._logger = createLogger({
            level: options.level,
            format: format.combine(
                format.errors({ stack: false }),
                format.simple(),
                format.colorize()
            ),
            transports: [],
        });

        if (options?.file) {
            const logpath = options.logpath;
            const filename = options.filename;

            if (logpath === undefined || filename === undefined) {
                throw new Error(
                    "logpath and filename must be set when file is true"
                );
            }

            this._logger.add(
                new transports.File({
                    filename: path.join(logpath, `${filename}.log`),
                    level: "info",
                })
            );
            this._logger.add(
                new transports.File({
                    filename: path.join(logpath, `${filename}_error.log`),
                    level: "error",
                })
            );
            this._logger.add(
                new transports.File({
                    filename: path.join(logpath, "debug.log"),
                    level: "debug",
                })
            );
        }

        if (options?.console || options?.file === undefined) {
            this._logger.add(
                new transports.Console({
                    level: options.level,
                    format: format.combine(
                        format.errors({ stack: false }),
                        format.simple()
                    ),
                })
            );
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getMessage(level: string, ...args: any[]) {
        const transArgs = args.map((a) => {
            if (
                typeof a == "object" &&
                !(a.stack != null && a.message != null)
            ) {
                const s = JSON.stringify(a);
                if (s != "{}") {
                    return s;
                }
            }

            return a;
        });
        return `${dayjs().format("YYYY-MM-DD HH:mm:ss")} ${lineNumber(2)} [${level.toUpperCase()}] (${process.pid}) ${transArgs.join(" ")}`;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    debug(...args: any[]) {
        this._logger.debug(this.getMessage("debug", ...args));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    info(...args: any[]) {
        this._logger.info(this.getMessage("info", ...args));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warn(...args: any[]) {
        this._logger.warn(this.getMessage("warn", ...args));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error(...args: any[]) {
        this._logger.error(this.getMessage("error", ...args));
    }
}

export default function getOrCreateLogger(
    name: string,
    options?: LoggerOptions
): Logger {
    if (loggerMaps.has(name)) return loggerMaps.get(name);

    const l = new Logger(
        Object.assign(
            {
                filename: name,
                logpath: "./",
                level: "info",
            },
            options
        )
    );
    loggerMaps.set(name, l);
    return l;
}

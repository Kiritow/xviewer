const { createLogger, format, transports } = require('winston')
const callsite = require("callsite")
const moment = require('moment')
const path = require("path")

const loggerMaps = new Map()

function lineNumber() {
    const stk = callsite()[3]
    return `${path.basename(stk.getFileName())}:${stk.getLineNumber()}`
}

class Logger {
    constructor(options) {
        this._logger = createLogger({
            level: options.level,
            format: format.combine(
                format.errors({ stack: false }),
                format.simple(),
                format.colorize(),
            ),
            transports: [],
        })

        if (options?.file) {
            this._logger.add(new transports.File({ filename: path.join(options.logpath, `${options.filename}.log`), level: "info" }))
            this._logger.add(new transports.File({ filename: path.join(options.logpath, `${options.filename}_error.log`), level: "error" }))
            this._logger.add(new transports.File({ filename: path.join(options.logpath, "debug.log"), level: "debug" }))
        }

        if (options?.console || options?.file == null) {
            this._logger.add(new transports.Console({
                level: options.level,
                format: format.combine(
                    format.errors({ stack: false }),
                    format.simple(),
                ),
            }))
        }
    }

    log(level, ...args) {
        const transArgs = args.map(a => {
            if (typeof a == 'object' && !(a.stack != null && a.message != null)) {
                const s = JSON.stringify(a)
                if (s != '{}') {
                    return s
                }
            }

            return a
        })
        const msg = `${moment().format("YYYY-MM-DD HH:mm:ss")} ${lineNumber()} [${level.toUpperCase()}] (${process.pid}) ${transArgs.join(' ')}`
        this._logger[level](msg)
    }

    debug(...args) {
        this.log('debug', ...args)
    }

    info(...args) {
        this.log('info', ...args)
    }

    warn(...args) {
        this.log('warn', ...args)
    }

    error(...args) {
        this.log('error', ...args)
    }
}

/**
 * 
 * @param {string} name 
 * @param {*} options 
 * @returns Logger
 */
function getOrCreateLogger(name, options) {
    if (loggerMaps.has(name)) return loggerMaps.get(name)

    const l = new Logger(Object.assign({
        filename: name,
        logpath: './',
        level: 'info',
    }, options))
    loggerMaps.set(name, l)
    return l
}

module.exports = getOrCreateLogger

import assert from "assert";

function readEnv(name: string, defaultValue?: string): string {
    const value = process.env[name];
    if (value === undefined) {
        if (defaultValue === undefined) {
            throw new Error(`environment variable ${name} is not set`);
        }
        return defaultValue;
    }
    return value;
}

export function GetKoaAppKeys(): string[] {
    const keys = readEnv("KOA_APP_KEYS");
    return keys.split(",");
}

export function GetESIndex(): string {
    return readEnv("ES_INDEX");
}

export function GetMySQLOptions() {
    return {
        host: readEnv("DB_HOST"),
        port: parseInt(readEnv("DB_PORT", "3306"), 10),
        user: readEnv("DB_USER"),
        password: readEnv("DB_PASS"),
        database: readEnv("DB_NAME"),
    };
}

export function GetRootPath() {
    return readEnv("ROOT_DIR");
}

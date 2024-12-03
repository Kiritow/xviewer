import assert from "assert";

export function GetKoaAppKeys(): string[] {
    assert(process.env.KOA_APP_KEYS, "KOA_APP_KEYS is not set");
    return process.env.KOA_APP_KEYS.split(",");
}

import { createHash } from "node:crypto";
export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

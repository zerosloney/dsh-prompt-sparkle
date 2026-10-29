#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src", "client.js"));
const built = readFileSync(join(root, "lib", "client.js"));
if (!source.equals(built)) {
  console.error("lib/client.js 与 src/client.js 不一致；请运行 npm run build");
  process.exit(1);
}

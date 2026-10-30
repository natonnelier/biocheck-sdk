#!/usr/bin/env node
// Checks (default, or --check) or rewrites (--write) the size and SHA-256 of
// every file listed in models.manifest.json against public/models/.
//
//   node scripts/models-manifest.mjs --check   # exit 1 on any mismatch
//   node scripts/models-manifest.mjs --write   # record sizes/hashes of present files
//   node scripts/models-manifest.mjs --sizes   # raw and Brotli (q11) size of each file
import { createHash } from "node:crypto";
import { brotliCompressSync, constants } from "node:zlib";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "models.manifest.json");
const modelsDir = join(root, "public", "models");
const write = process.argv.includes("--write");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (process.argv.includes("--sizes")) {
  const mb = (n) => (n / 1e6).toFixed(2).padStart(8) + " MB";
  let raw = 0, br = 0;
  for (const f of manifest.files) {
    const path = join(modelsDir, f.src);
    if (!existsSync(path)) {
      console.log(`MISSING   ${f.id}`);
      continue;
    }
    const bytes = readFileSync(path);
    const compressed = brotliCompressSync(bytes, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
    }).length;
    raw += bytes.length;
    br += compressed;
    console.log(`${f.id.padEnd(24)} raw ${mb(bytes.length)}   brotli ${mb(compressed)}   (${bytes.length} / ${compressed} B)`);
  }
  console.log(`${"TOTAL".padEnd(24)} raw ${mb(raw)}   brotli ${mb(br)}`);
  process.exit(0);
}
let failed = false;

for (const f of manifest.files) {
  const path = join(modelsDir, f.src);
  if (!existsSync(path)) {
    console.log(`MISSING   ${f.id.padEnd(24)} ${f.src}`);
    failed = true;
    continue;
  }
  const bytes = readFileSync(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (write) {
    f.size = bytes.length;
    f.sha256 = sha256;
    console.log(`RECORDED  ${f.id.padEnd(24)} ${f.src}`);
  } else if (f.sha256 == null) {
    console.log(`UNPINNED  ${f.id.padEnd(24)} ${f.src} (run with --write to pin)`);
  } else if (f.sha256 !== sha256 || f.size !== bytes.length) {
    console.log(`MISMATCH  ${f.id.padEnd(24)} ${f.src}`);
    failed = true;
  } else {
    console.log(`OK        ${f.id.padEnd(24)} ${f.src}`);
  }
}

if (write) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
process.exit(!write && failed ? 1 : 0);

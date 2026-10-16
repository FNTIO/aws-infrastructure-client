// The public repo's own guard, run by .github/workflows/secret-scan.yml on every push: the generic
// classes in scripts/public-gate.mjs (account and resource ids, generated AWS hostnames, Cognito ids,
// credentials, private keys, local paths, real addresses) over every tracked text file. Warnings
// (public IPs, hostnames outside the allowlist) are printed for the reviewer; failures block.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { GENERIC_RULES, FORBIDDEN_FILES, TEXT, scanText } from "./public-gate.mjs";

const files = execSync("git ls-files -z").toString().split("\0").filter(Boolean);
const fail = [];
const warn = [];
let scanned = 0;
for (const f of files) {
  if (FORBIDDEN_FILES.test(f)) fail.push(`${f}: file of a kind that never belongs in this repo`);
  if (!TEXT.test(f) || /(^|\/)package-lock\.json$/.test(f)) continue;
  scanned++;
  for (const x of scanText(f, fs.readFileSync(f, "utf8"), "docs", GENERIC_RULES)) (x.severity === "fail" ? fail : warn).push(`${x.at}  [${x.why}]`);
}
if (warn.length) console.log(`review — ${warn.length} line(s):\n` + warn.map((w) => "  " + w).join("\n"));
if (fail.length) {
  console.error(`FAIL — ${fail.length} line(s):\n` + fail.map((x) => "  " + x).join("\n"));
  process.exit(1);
}
console.log(`check-public: ${scanned} files clean`);

// Class-based rules for what must never reach a public surface, written for the values that COULD be
// added later, not only the ones that leaked once: AWS account and resource ids, generated AWS hostnames,
// Cognito ids, credentials and vendor tokens, private-key blocks, local paths, real addresses, public IPs,
// hostnames outside the fixture/vendor allowlist. Every rule has a positive and a negative sample in
// public-gate.test.mjs. This file carries no deployment value and is copied verbatim into the public repo
// (scripts/public-gate.mjs there); the private wrapper public-gate.mjs adds our own values on top.
//
// Scopes: "docs" = exported documentation, "full" = compiled code, package docs and product source,
// "bundle" = built Lambda/web bundles (third-party code inlined, so only rules that cannot misfire there).
import fs from "node:fs";
import path from "node:path";

export const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|mdx|yml|yaml|toml|html|css|scss|txt|plist|svg|sh|xml|example|editorconfig|prettierrc|gitignore|prettierignore|browserslistrc)$|(^|\/)(\.[a-z]+|LICENSE|NOTICE|README|CHANGELOG)$/i;

// ---- placeholders -------------------------------------------------------------------------------------
// Fictional accounts the Storybook fixtures use ("Acme Production" and friends).
export const FIXTURE_ACCOUNTS = new Set(["448210007710", "990144552201", "442188901204", "442188907710", "908311452299", "590183957904", "112233445566"]);
export const isPlaceholderAccount = (n) =>
  /^(\d)\1{11}$/.test(n) || /^(\d)\1{3}(\d)\2{3}(\d)\3{3}$/.test(n) || /^10{11}$/.test(n) || n === "123456789012" || FIXTURE_ACCOUNTS.has(n);
// Hex that reads as made up: runs of one character, counting sequences, "abcdef", "a1b2c3", "deadbeef".
export const isPlaceholderHex = (h) => /(.)\1{7,}/.test(h) || /(1234|abcdef|0123|a1b2c3|dead|beef|cafe|face|feed)/.test(h);
// A UUID's last group is 12 hex digits and can be all-decimal (invented user ids in fixtures).
export const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
export const ZONE_ALLOW = new Set(["Z0000000000000000000A", "Z0ABC12DEF34GH", "Z2FDTNDATAQYW2"]); // test + README placeholders, CloudFront's fixed zone
// A generated AWS label always carries digits; a label without any is a name somebody chose.
const placeholderLabel = (l) => !/\d/.test(l) || /(.)\1{3,}/.test(l) || /example|xxxx|abc|1111|0000|placeholder|your-|my-|^cluster-[a-z0-9]{1,4}$/.test(l);
const AWS_HOST_SUFFIX = /\.(?:cloudfront\.net|execute-api\.[a-z0-9-]+\.amazonaws\.com|elb\.amazonaws\.com|elb\.[a-z0-9-]+\.amazonaws\.com|[a-z0-9-]+\.rds\.amazonaws\.com|awsapprunner\.com|amplifyapp\.com|lambda-url\.[a-z0-9-]+\.on\.aws|auth\.[a-z0-9-]+\.amazoncognito\.com|amazoncognito\.com)$/;
// The generated part of the host reads as a placeholder: for RDS the cluster label decides, elsewhere every label must.
const isPlaceholderAwsHost = (host) => {
  const labels = host.replace(AWS_HOST_SUFFIX, "").split(".");
  const cluster = labels.find((l) => /^cluster-/.test(l));
  return cluster ? placeholderLabel(cluster) : labels.every(placeholderLabel);
};

// Addresses on these domains are fixtures or vendors; anything else is somebody's real address.
export const EMAIL_ALLOW = /(?:example\.(?:com|org|net|test)|example-corp\.com|acme\.com|company\.com|host\.com|b\.com?|other\.com|alignui\.com|(?:users\.)?noreply\.github\.com|anthropic\.com)$/i;

// Registrable domains that legitimately appear in product code and docs. A hostname on any other domain
// is reported for review: it is where a customer's or an internal host would show up first.
export const HOST_ALLOW = new Set([
  "example.com", "example.org", "example.net", "example.test", "example-corp.com", "acme.com", "company.com", "host.com", "other.com", "alignui.com", "corp-sso.com",
  "amazonaws.com", "amazon.com", "amazoncognito.com", "awsstatic.com", "on.aws", "ecr.aws",
  "microsoftonline.com", "live.com", "microsoft.com", "windows.net", "azure.com",
  "github.com", "githubusercontent.com", "github.io", "ghcr.io", "npmjs.com", "npmjs.org", "unpkg.com", "jsdelivr.net", "nodejs.org",
  "w3.org", "ietf.org", "rfc-editor.org", "schema.org", "json-schema.org", "openapis.org", "swagger.io", "spec.openapis.org",
  "angular.dev", "angular.io", "typescriptlang.org", "electronjs.org", "electron.build", "storybook.js.org", "playwright.dev", "jestjs.io", "karma-runner.github.io", "radix-ui.com", "fontawesome.com",
  "tailscale.com", "headscale.net", "docker.com", "debian.org", "alpinelinux.org", "letsencrypt.org", "mozilla.org", "google.com", "googleapis.com", "gstatic.com", "apple.com", "cloudflare.com",
  "wikipedia.org", "stackoverflow.com", "postman.com", "gitleaks.io", "keycloak.org", "okta.com", "auth0.com", "elastic.co", "opensource.org", "ts.net",
]);
// Public suffixes a hostname can end in; a dotted name ending in anything else (a property chain, an
// .internal or .test name) is not a public host.
const TLDS = new Set(["com", "net", "org", "io", "dev", "de", "app", "cloud", "sh", "ai", "eu", "tech", "biz", "uk", "fr", "nl", "dk", "cz", "jp", "au", "ca", "br", "mx", "aws", "co"]);
const isPublicHost = (host, line) => {
  const labels = host.split(".");
  if (!TLDS.has(labels[labels.length - 1])) return false;
  // A bare two-label name in prose ("foo.app") is mostly noise; count it only when written as a host.
  if (labels.length === 2 && !line.includes("//" + host) && !line.includes("@" + host) && !line.includes("*." + host)) return false;
  return true;
};
const registrable = (host) => {
  const parts = host.split(".");
  const two = parts.slice(-2).join(".");
  const three = parts.slice(-3).join(".");
  if (/^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(two)) return three; // two-part public suffixes
  return HOST_ALLOW.has(three) ? three : two;
};
// RFC 1918/6598, loopback, link-local, multicast, documentation ranges, "this network", broadcast.
const isNonPublicIp = (ip) => {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 51 || b === 18 || b === 19)) || (a === 203 && b === 0) || ip === "255.255.255.255" || ip === "1.1.1.1" || ip === "8.8.8.8" || ip === "8.8.4.4";
};

const ALL = new Set(["docs", "full", "bundle"]);
const NOT_BUNDLE = new Set(["docs", "full"]);

/** @type {{id:string, why:string, re:RegExp, ok?:(m:string, line:string)=>boolean, scopes:Set<string>, severity:"fail"|"warn", blankUuids?:boolean}[]} */
export const GENERIC_RULES = [
  { id: "account-id", why: "12-digit number that is not a documentation placeholder (AWS account id)", re: /\b\d{12}\b/g, ok: isPlaceholderAccount, scopes: ALL, severity: "fail", blankUuids: true },
  { id: "aws-resource-id", why: "AWS resource id that does not read as a placeholder", re: /\b(?:vpc|subnet|sg|igw|nat|rtb|acl|pcx|tgw|vpce|eni|eipalloc|ami|vol|snap|fs|fsap|lt|i)-(?:[0-9a-f]{17}|[0-9a-f]{8})\b/g, ok: (m) => isPlaceholderHex(m.split("-")[1]), scopes: ALL, severity: "fail" },
  { id: "hosted-zone-id", why: "Route 53 hosted zone id", re: /\bZ[0-9A-Z]{13,}\b/g, ok: (m) => ZONE_ALLOW.has(m) || /^(.)\1+$/.test(m.slice(1)) || /EXAMPLE/.test(m), scopes: NOT_BUNDLE, severity: "fail" },
  { id: "cognito-pool-id", why: "Cognito user pool id", re: /\b[a-z]{2}-[a-z]+-\d_[A-Za-z0-9]{9}\b/g, ok: (m) => /_(EXAMPLE|X{9}|x{9})/.test(m), scopes: ALL, severity: "fail" },
  { id: "cognito-client-id", why: "26-character lowercase token (Cognito app client id)", re: /\b(?=[a-z0-9]{26}\b)(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{26}\b/g, ok: (m) => /^x+$|example/.test(m), scopes: NOT_BUNDLE, severity: "fail" },
  { id: "aws-generated-host", why: "AWS-generated hostname (CloudFront, API Gateway, ELB, RDS, App Runner, Amplify, Lambda URL, Cognito domain)", re: /\b[a-z0-9.-]+\.(?:cloudfront\.net|execute-api\.[a-z0-9-]+\.amazonaws\.com|elb\.amazonaws\.com|elb\.[a-z0-9-]+\.amazonaws\.com|rds\.amazonaws\.com|awsapprunner\.com|amplifyapp\.com|lambda-url\.[a-z0-9-]+\.on\.aws|amazoncognito\.com)\b/g, ok: isPlaceholderAwsHost, scopes: ALL, severity: "fail" },
  { id: "aws-access-key", why: "AWS access key id", re: /\b(?:AKIA|ASIA|AROA|AIDA|AGPA|ANPA|ANVA|APKA)[0-9A-Z]{16}\b/g, ok: (m) => /EXAMPLE/.test(m), scopes: ALL, severity: "fail" },
  { id: "aws-secret-key", why: "AWS secret access key next to its name", re: /(?:aws_secret_access_key|secretAccessKey|SecretAccessKey)["']?\s*[:=]\s*["']?[A-Za-z0-9/+]{40}\b/g, ok: (m) => /EXAMPLE|x{10}/.test(m), scopes: ALL, severity: "fail" },
  { id: "private-key-block", why: "private key material", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g, scopes: ALL, severity: "fail" },
  { id: "vendor-token", why: "vendor credential (GitHub, npm, Slack, Tailscale, OpenAI, Google)", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|npm_[A-Za-z0-9]{36}|xox[abprs]-[A-Za-z0-9-]{10,}|tskey-(?:auth|api|client)-[A-Za-z0-9-]+|sk-[A-Za-z0-9]{32,}|AIza[0-9A-Za-z_-]{35})\b/g, scopes: ALL, severity: "fail" },
  { id: "jwt", why: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, scopes: ALL, severity: "fail" },
  { id: "slack-webhook", why: "Slack incoming webhook", re: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g, scopes: ALL, severity: "fail" },
  { id: "local-path", why: "path from somebody's machine", re: /(?:\/Users\/[A-Za-z0-9._-]+\/|\/home\/[a-z][A-Za-z0-9._-]*\/|[A-Z]:\\Users\\[^\\\s"']+)/g, ok: (m) => /\/(?:you|me|<[^>]+>|\$[A-Za-z_]+|runner|user|username|name|yourname|example)\//.test(m) || /\\(?:you|<[^>]+>|%[^%]+%)/.test(m), scopes: ALL, severity: "fail" },
  { id: "email", why: "address outside the fixture and vendor domains", re: /[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, ok: (m) => EMAIL_ALLOW.test(m.split("@")[1]), scopes: NOT_BUNDLE, severity: "fail" },
  { id: "private-repo-link", why: "link into the private source repo (404 for outsiders)", re: /github\.com\/FNTIO\/infra-client(?!-)\//g, scopes: ALL, severity: "fail" },
  { id: "retired-repo", why: "the retired public repo name (a dead feed for installed apps)", re: /FNTIO\/infra-client-public/g, scopes: ALL, severity: "fail" },
  // Lookarounds exclude SVG path data and version strings, where four dotted numbers are not an address.
  { id: "public-ip", why: "public IPv4 address", re: /(?<![\w.-])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.-])/g, ok: isNonPublicIp, scopes: NOT_BUNDLE, severity: "warn" },
  { id: "unknown-host", why: "hostname outside the fixture/vendor allowlist (a customer's or an internal host?)", re: /\b(?:[a-z0-9-]+\.)+[a-z]{2,24}\b(?![\w(])/g, ok: (m, line) => !isPublicHost(m, line) || HOST_ALLOW.has(registrable(m)), scopes: NOT_BUNDLE, severity: "warn" },
];

// Files that must never ship or be exported, whatever they contain.
export const FORBIDDEN_FILES = /(^|\/)(\.env(\..*)?|\.npmrc|cdk\.context\.json|\.DS_Store|.*\.(map|pem|key|p12|p8|tsbuildinfo|log))$/;

/** Scan one text in one scope. Returns findings as { severity, at, why }. */
export function scanText(rel, text, scope, rules) {
  const out = [];
  const active = rules.filter((r) => r.scopes.has(scope));
  text.split("\n").forEach((line, i) => {
    if (!line) return;
    for (const r of active) {
      const subject = r.blankUuids ? line.replace(UUID, "") : line;
      for (const m of subject.matchAll(r.re)) {
        if (r.ok && r.ok(m[0], line)) continue;
        out.push({ id: r.id, severity: r.severity, at: `${rel}:${i + 1}: ${line.trim().slice(0, 100)}`, why: `${r.why}: ${m[0]}` });
      }
    }
  });
  return out;
}

/**
 * Scan every text file under `dir`. `classify(rel)` returns "skip", "bundle", "full" or "docs".
 * Returns { fail, warn, files, binaries } (binaries: non-text files seen, for the caller to judge).
 */
export function scanTree(dir, classify, rules) {
  const fail = [];
  const warn = [];
  const binaries = [];
  let files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      if (e.isDirectory()) {
        if (e.name !== ".git") walk(p);
        continue;
      }
      const kind = classify(rel);
      if (kind === "skip") continue;
      if (FORBIDDEN_FILES.test(rel)) fail.push(`${rel}: file of a kind that never ships (secrets, lockfile-free paths, source maps)`);
      // Lockfiles hold registry URLs, hashes and upstream maintainers' addresses, never our values.
      if (!TEXT.test(p)) {
        binaries.push(rel);
        continue;
      }
      if (/(^|\/)package-lock\.json$/.test(p)) continue;
      files++;
      for (const f of scanText(rel, fs.readFileSync(p, "utf8"), kind, rules)) (f.severity === "fail" ? fail : warn).push(`${f.at}  [${f.why}]`);
    }
  };
  walk(dir);
  return { fail, warn, files, binaries };
}

// Production code importing a test, story or e2e module ships that module's contents (fixtures imported
// by the preview pages are scanned as product code; stories and specs are not).
export const TEST_IMPORT = /\bfrom\s+["'][^"']*(?:\.stories|\.spec|\.test|__tests__|\/e2e\/)[^"']*["']/;
export const isTestFile = (rel) => /(^|\/)(__tests__|e2e)\/|\.(spec|test|stories)\.[cm]?[jt]sx?$|\.mdx$/.test(rel);
// Third-party code shipped verbatim — AWS's fingerprint collector under frontend/public/vendor, the API's
// vendor_modules — carries upstream's hostnames and magic numbers, never ours, so it is skipped everywhere.
// The flip side: nothing of our own may live under a vendor/ folder.
export const isVendoredFile = (rel) => /(^|\/)(vendor|vendor_modules)\//.test(rel);

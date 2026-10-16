#!/usr/bin/env node
// Verifies wiki/*.md before it is mirrored to the GitHub wiki:
//   - [[Page]] links resolve to a page in wiki/
//   - absolute links into this repo point at an existing file, and the
//     #anchor (if any) matches a heading in that file (GitHub's slug rules)
//   - no relative file paths (they do not resolve inside a wiki)
//   - no 12-digit numbers (AWS account ids; the wiki goes public with the repo),
//     except AWS's own documentation placeholders
// Usage: node .github/scripts/check-wiki-links.mjs   (exit 1 on any finding)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wikiDir = join(root, 'wiki');
const REPO = 'https://github.com/FNTIO/aws-infrastructure-client';
const PLACEHOLDER_IDS = new Set(['111122223333', '444455556666', '123456789012']);

const pages = readdirSync(wikiDir).filter((f) => f.endsWith('.md'));
const pageKeys = new Map(pages.map((f) => [f.slice(0, -3).toLowerCase(), f]));
const pageKey = (title) => decodeURIComponent(title).trim().replace(/\s+/g, '-').toLowerCase();

function slug(raw) {
  const text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase();
  return text.replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
}

const slugCache = new Map();
function headingSlugs(file) {
  if (slugCache.has(file)) return slugCache.get(file);
  const seen = new Map();
  const out = new Set();
  let fence = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    let s = slug(m[1]);
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    if (n) s = `${s}-${n}`;
    out.add(s);
  }
  slugCache.set(file, out);
  return out;
}

function stripCode(md) {
  return md.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, (c) => ' '.repeat(c.length));
}

const findings = [];
const report = (file, line, msg) => findings.push(`wiki/${file}:${line}: ${msg}`);

function checkAnchor(file, line, target, mdFile, anchor) {
  if (!anchor || !mdFile.endsWith('.md')) return;
  if (!headingSlugs(mdFile).has(anchor.toLowerCase())) report(file, line, `no heading "#${anchor}" in ${target}`);
}

for (const file of pages) {
  const text = stripCode(readFileSync(join(wikiDir, file), 'utf8'));
  const lines = text.split('\n');
  lines.forEach((ln, i) => {
    const line = i + 1;

    for (const m of ln.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const parts = m[1].split('|');
      const [title, anchor] = parts[parts.length - 1].split('#');
      const hit = pageKeys.get(pageKey(title));
      if (!hit) report(file, line, `wiki page "${title}" does not exist`);
      else checkAnchor(file, line, title, join(wikiDir, hit), anchor);
    }

    for (const m of ln.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (target.startsWith(`${REPO}/wiki`)) {
        const rest = target.slice(`${REPO}/wiki`.length).replace(/^\//, '');
        if (!rest) continue;
        const [title, anchor] = rest.split('#');
        const hit = pageKeys.get(pageKey(title));
        if (!hit) report(file, line, `wiki page "${title}" does not exist`);
        else checkAnchor(file, line, title, join(wikiDir, hit), anchor);
        continue;
      }
      const repoLink = new RegExp(`^${REPO}/(?:blob|tree)/main/([^#?]*)(?:#(.*))?$`).exec(target);
      if (repoLink) {
        const path = decodeURIComponent(repoLink[1]);
        const abs = join(root, path);
        if (!existsSync(abs)) {
          report(file, line, `repo path does not exist: ${path}`);
        } else if (repoLink[2] && statSync(abs).isFile() && !/^L\d+/.test(repoLink[2])) {
          checkAnchor(file, line, path, abs, repoLink[2]);
        }
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // other absolute URL (or mailto)
      if (target.startsWith('#')) {
        checkAnchor(file, line, file, join(wikiDir, file), target.slice(1));
        continue;
      }
      if (target.includes('/') || /\.\w+$/.test(target)) {
        report(file, line, `relative path "${target}" will not resolve inside the wiki; link the page name or an absolute ${REPO}/blob/main/... URL`);
        continue;
      }
      const [title, anchor] = target.split('#');
      const hit = pageKeys.get(pageKey(title));
      if (!hit) report(file, line, `wiki page "${title}" does not exist`);
      else checkAnchor(file, line, title, join(wikiDir, hit), anchor);
    }

    for (const m of ln.matchAll(/(?<![\d.-])\d{12}(?![\d.-])/g)) {
      if (PLACEHOLDER_IDS.has(m[0])) continue;
      report(file, line, `12-digit number "${m[0]}" looks like an AWS account id; the wiki must not carry deployment-specific values`);
    }
  });
}

if (findings.length) {
  console.error(findings.join('\n'));
  console.error(`\n${findings.length} problem(s) in wiki/`);
  process.exit(1);
}
console.log(`wiki/: ${pages.length} pages, all links and anchors resolve`);

#!/usr/bin/env node
/**
 * illusion — find defects that survive a green test suite.
 *
 * SAFETY (see SECURITY.md): reads local files only. No network access, no telemetry, no
 * dependencies, and it never writes to the files it scans. Your source never leaves your machine.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative, resolve } from 'node:path';
import { analyse, RULES } from '../src/rules.mjs';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit', '.vercel', '.cache', 'vendor']);
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const MAX_BYTES = 2_000_000;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);

if (flag('--help') || flag('-h')) {
  console.log(`illusion — find defects that survive a green test suite

  usage: illusion [path] [options]

  options:
    --json            machine-readable output
    --min=<sev>       only report at or above: low | medium | high
    --quiet           findings only, no summary
    --no-exit-code    always exit 0 (default: exit 1 when findings exist)
    -h, --help        this text

  rules:
${Object.entries(RULES).map(([k, v]) => `    ${k.padEnd(16)} ${v.severity.padEnd(7)} ${v.title}`).join('\n')}

  suppress a line by putting "illusion-ignore" in it or the line above.

  privacy: runs entirely offline. no network, no telemetry, no dependencies.`);
  process.exit(0);
}

const target = resolve(argv.find((a) => !a.startsWith('-')) || '.');
const asJson = flag('--json');
const quiet = flag('--quiet');
const minArg = (argv.find((a) => a.startsWith('--min=')) || '').split('=')[1];
const ORDER = { low: 0, medium: 1, high: 2 };
const minSev = ORDER[minArg] ?? 0;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') { if (SKIP.has(e.name)) continue; }
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    try {
      if (e.isDirectory()) walk(p, out);
      else if (e.isFile() && EXTS.has(extname(p)) && statSync(p).size <= MAX_BYTES) out.push(p);
    } catch { /* unreadable entry: skip, deliberate — a scan should never crash on one bad file */ }
  }
  return out;
}

let files = [];
try {
  const st = statSync(target);
  files = st.isDirectory() ? walk(target) : [target];
} catch {
  console.error(`illusion: cannot read ${target}`);
  process.exit(2);
}

const findings = [];
for (const f of files) {
  let src;
  try { src = readFileSync(f, 'utf-8'); } catch { continue; }
  for (const hit of analyse(f, src)) {
    const meta = RULES[hit.rule];
    if ((ORDER[meta.severity] ?? 0) < minSev) continue;
    findings.push({ ...hit, file: relative(process.cwd(), hit.file) || hit.file, severity: meta.severity, title: meta.title, why: meta.why });
  }
}

if (asJson) {
  console.log(JSON.stringify({ scanned: files.length, findings }, null, 2));
} else {
  const byRule = findings.reduce((a, f) => { (a[f.rule] ||= []).push(f); return a; }, {});
  const order = Object.keys(RULES).sort((a, b) => (ORDER[RULES[b].severity] - ORDER[RULES[a].severity]));
  for (const rule of order) {
    const group = byRule[rule];
    if (!group?.length) continue;
    console.log(`\n${RULES[rule].severity.toUpperCase()}  ${rule} — ${RULES[rule].title}  (${group.length})`);
    console.log(`  ${RULES[rule].why}\n`);
    for (const f of group) {
      console.log(`  ${f.file}:${f.line}`);
      console.log(`    ${f.snippet}`);
    }
  }
  if (!quiet) {
    console.log(`\nscanned ${files.length} file(s) · ${findings.length} finding(s)`);
    if (!findings.length) console.log('no illusion-of-correctness patterns detected.');
  }
}

process.exitCode = flag('--no-exit-code') ? 0 : (findings.length ? 1 : 0);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, RULES } from '../src/rules.mjs';

const rules = (file, src) => analyse(file, src).map((f) => f.rule);

// ── NULLISH_CMP ───────────────────────────────────────────────────────────────
// Derived from a real defect: an entitlement check where a NEGATIVE balance passed
// the gate, because `?? 0 > 0` parses as `?? (0 > 0)`.
test('NULLISH_CMP: flags unparenthesised ?? before a comparison', () => {
  assert.ok(rules('api/gate.ts', 'if (org?.balance_seconds ?? 0 > 0) { proceed(); }').includes('NULLISH_CMP'));
});

test('NULLISH_CMP: correctly parenthesised code is NOT flagged', () => {
  assert.ok(!rules('api/gate.ts', 'if (((org?.balance_seconds) ?? 0) > 0) { proceed(); }').includes('NULLISH_CMP'));
});

test('NULLISH_CMP: ignores ?? with no comparison', () => {
  assert.ok(!rules('api/gate.ts', 'const n = value ?? 0;').includes('NULLISH_CMP'));
});

// ── FAIL_OPEN ─────────────────────────────────────────────────────────────────
// Derived from a real defect: a paywall queried a column that did not exist, the query
// errored, the row came back null, and the gate returned "allow".
test('FAIL_OPEN: gate returning null on its own lookup error', () => {
  const src = `
async function checkBalance(userId) {
  const { data: profile, error } = await admin.from('profiles').select('plan, balance').single();
  if (error) return null;
  return profile.balance <= 0 ? DENY : null;
}`;
  assert.ok(rules('api/transcribe.ts', src).includes('FAIL_OPEN'));
});

test('FAIL_OPEN: missing record treated as authorised', () => {
  const src = `
async function checkAccess(id) {
  const { data } = await db.from('subscriptions').select('plan').single();
  if (!data) return null;
  return evaluate(data);
}`;
  assert.ok(rules('api/access.ts', src).includes('FAIL_OPEN'));
});

test('FAIL_OPEN: not flagged outside an entitlement context', () => {
  const src = `
async function loadAvatar(id) {
  const { data, error } = await db.from('images').select('url').single();
  if (error) return null;
  return data.url;
}`;
  assert.ok(!rules('lib/avatar.ts', src).includes('FAIL_OPEN'));
});

test('FAIL_OPEN: never reported from test files', () => {
  const src = `
function checkBalance(p) { if (error) return null; }
describe('billing', () => {});`;
  assert.ok(!rules('test/billing.test.ts', src).includes('FAIL_OPEN'));
});

// ── LOST_ASYNC ────────────────────────────────────────────────────────────────
// Derived from a real defect: telemetry written with `void` immediately before the
// response. 538 tests passed; zero rows were ever written in production.
test('LOST_ASYNC: void async call immediately before a response', () => {
  const src = `
  void logApiCall({ route: '/api/x', status_code: 402 });
  return res.status(402).json({ error: 'nope' });`;
  assert.ok(rules('api/x.ts', src).includes('LOST_ASYNC'));
});

test('LOST_ASYNC: awaited call is NOT flagged', () => {
  const src = `
  await logApiCall({ route: '/api/x', status_code: 402 });
  return res.status(402).json({ error: 'nope' });`;
  assert.ok(!rules('api/x.ts', src).includes('LOST_ASYNC'));
});

test('LOST_ASYNC: void with no nearby response is NOT flagged', () => {
  const src = `
  void backgroundReindex();
  const more = await doOtherWork();
  return more;`;
  assert.ok(!rules('worker.ts', src).includes('LOST_ASYNC'));
});

// ── TAUTOLOGY ─────────────────────────────────────────────────────────────────
// Derived from a real defect: a test carrying its own correct copy of a gate stayed
// green for months while the shipped gate was broken.
test('TAUTOLOGY: test that declares it mirrors production code', () => {
  const src = `/** Mirrors checkBalance() in api/transcribe.ts */
function checkBalance(p) { return p.balance > 0; }`;
  assert.ok(rules('test/organisations.test.ts', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: test that defines the very function it describes', () => {
  const src = `
function computeVerdict(p) { return p.ok; }
describe('computeVerdict', () => { it('works', () => {}); });`;
  assert.ok(rules('test/verdict.test.mjs', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: importing the real implementation is NOT flagged', () => {
  const src = `
import { computeVerdict } from '../src/verdict.js';
describe('computeVerdict', () => { it('works', () => {}); });`;
  assert.ok(!rules('test/verdict.test.mjs', src).includes('TAUTOLOGY'));
});

// ── SILENT_SWALLOW ────────────────────────────────────────────────────────────
test('SILENT_SWALLOW: empty catch is flagged', () => {
  assert.ok(rules('a.ts', 'try { risky(); } catch {}').includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: a stated-deliberate swallow stands down', () => {
  const src = `try { risky(); } catch {
    // Fire-and-forget: never propagate errors to the caller.
  }`;
  assert.ok(!rules('lib/logger.ts', src).includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: catch that handles the error is NOT flagged', () => {
  const src = `try { risky(); } catch (e) {
    report(e);
  }`;
  assert.ok(!rules('a.ts', src).includes('SILENT_SWALLOW'));
});

// ── suppression + hygiene ─────────────────────────────────────────────────────
test('illusion-ignore on the line suppresses a finding', () => {
  assert.ok(!rules('a.ts', 'if (x ?? 0 > 0) {} // illusion-ignore').includes('NULLISH_CMP'));
});

test('illusion-ignore on the preceding line suppresses a finding', () => {
  assert.ok(!rules('a.ts', '// illusion-ignore\nif (x ?? 0 > 0) {}').includes('NULLISH_CMP'));
});

test('clean source produces no findings', () => {
  const src = `
export function add(a, b) { return a + b; }
export const double = (n) => n * 2;`;
  assert.equal(analyse('src/math.ts', src).length, 0);
});

test('analyse never throws on odd input', () => {
  for (const bad of ['', null, undefined, 123, {}]) {
    assert.doesNotThrow(() => analyse('x.ts', bad));
  }
});

test('every rule declares severity, title and why', () => {
  for (const [name, meta] of Object.entries(RULES)) {
    assert.ok(['low', 'medium', 'high'].includes(meta.severity), `${name} severity`);
    assert.ok(meta.title?.length > 5, `${name} title`);
    assert.ok(meta.why?.length > 20, `${name} why`);
  }
});

// ── SAFETY: the guarantee we make to users, enforced by a test ────────────────
test('SAFETY: rules module performs no I/O and opens no network connections', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/rules.mjs', import.meta.url), 'utf-8');
  for (const forbidden of ['node:fs', 'node:net', 'node:http', 'node:https', 'node:child_process', 'fetch(', 'XMLHttpRequest', 'require(']) {
    assert.ok(!src.includes(forbidden), `rules.mjs must not reference ${forbidden}`);
  }
});

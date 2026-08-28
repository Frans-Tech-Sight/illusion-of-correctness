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

test('TAUTOLOGY: test that defines the very function it describes AND asserts on it', () => {
  const src = `
function computeVerdict(p) { return p.ok; }
describe('computeVerdict', () => { it('works', () => { expect(computeVerdict({ok:1})).toBe(1); }); });`;
  assert.ok(rules('test/verdict.test.mjs', src).includes('TAUTOLOGY'));
});

// CONTRACT CHANGE, 0.3.0 (deliberate, not a regression): a local function that is
// described but never ASSERTED ON is no longer TAUTOLOGY. It is a vacuous test —
// a different defect — and treating it as a tautology is what flagged React
// fixture components across five monorepos.
test('TAUTOLOGY: described but never asserted on is NOT flagged (vacuous, not tautological)', () => {
  const src = `
function computeVerdict(p) { return p.ok; }
describe('computeVerdict', () => { it('works', () => {}); });`;
  assert.ok(!rules('test/verdict.test.mjs', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: importing the real implementation is NOT flagged', () => {
  const src = `
import { computeVerdict } from '../src/verdict.js';
describe('computeVerdict', () => { it('works', () => {}); });`;
  assert.ok(!rules('test/verdict.test.mjs', src).includes('TAUTOLOGY'));
});

// ── SILENT_SWALLOW ────────────────────────────────────────────────────────────
// Contract since 0.2.0, driven by the 2026-08-28 precision sweep: an
// unrestricted empty-catch rule produced 46 findings on eight famous repos and
// every hand-checked one was deliberate. The rule now fires only for a NAMED,
// non-underscore binding, outside test files, in money/access/notification
// context — the incident class it was distilled from.

test('SILENT_SWALLOW: named empty catch in a payment path is flagged', () => {
  const src = `async function confirmPayment(id) {
  try { await sendPaymentConfirmed(id); } catch (e) {}
}`;
  assert.ok(rules('lib/billing.ts', src).includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: bare catch {} is the deliberate-ignore idiom — NOT flagged', () => {
  const src = `async function confirmPayment(id) {
  try { await sendPaymentConfirmed(id); } catch {}
}`;
  assert.ok(!rules('lib/billing.ts', src).includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: _-prefixed binding is the deliberate-ignore idiom — NOT flagged', () => {
  const src = `async function confirmPayment(id) {
  try { await sendPaymentConfirmed(id); } catch (_err) {}
}`;
  assert.ok(!rules('lib/billing.ts', src).includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: empty catch OUTSIDE money/access context is NOT flagged', () => {
  // Feature detection, optional niceties — the shape that made famous repos
  // light up. Out of scope by design.
  const src = `function supportsColour() {
  try { probeTerminal(); } catch (e) {}
}`;
  assert.ok(!rules('lib/tty.ts', src).includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: never reported from test files (catch can BE the assertion)', () => {
  const src = `it('rejects bad payment input', () => {
  try { chargePayment(null); } catch (e) { hit = true; }
});
try { chargePayment(null); } catch (e) {}`;
  assert.ok(!rules('test/billing.test.ts', src).includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: a stated-deliberate swallow stands down even in context', () => {
  const src = `try { await sendPaymentConfirmed(id); } catch (e) {
    // Fire-and-forget: never propagate errors to the caller.
  }`;
  assert.ok(!rules('lib/billing.ts', src).includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: catch that handles the error is NOT flagged', () => {
  const src = `try { await sendPaymentConfirmed(id); } catch (e) {
    report(e);
  }`;
  assert.ok(!rules('lib/billing.ts', src).includes('SILENT_SWALLOW'));
});

// ── string-literal immunity (webpack CssLoadingRuntimeModule regression) ──────
// The scanner once reported `catch(e) {}` INSIDE a string of embedded runtime
// JS as a finding in the host file. Code in strings is data, not code.

test('STRINGS: catch inside a double-quoted string is NOT a finding', () => {
  const src = `const runtime = "try { load(); } catch(e) {} // payment retry";
async function chargePayment() {}`;
  assert.ok(!rules('lib/billing.ts', src).includes('SILENT_SWALLOW'));
});

test('STRINGS: pattern inside a multi-line template literal is NOT a finding', () => {
  const src = 'const snippet = `\n' +
    'balance example: if (x ?? 0 > 0) { pay(); }\n' +
    'try { charge(); } catch (e) {}\n' +
    '`;\nexport function billing() {}';
  const found = rules('lib/billing.ts', src);
  assert.ok(!found.includes('NULLISH_CMP'));
  assert.ok(!found.includes('SILENT_SWALLOW'));
});

test('STRINGS: real code AFTER a closed template literal is still scanned', () => {
  const src = 'const s = `harmless`;\nconst v = x ?? 0 > 0;';
  assert.ok(rules('a.ts', src).includes('NULLISH_CMP'));
});

test('STRINGS: quoted code inside a line comment is NOT a finding', () => {
  const src = '// bad shape: try { f(); } catch (e) {}  seen in a payment path once\nexport function billing() {}';
  assert.ok(!rules('lib/billing.ts', src).includes('SILENT_SWALLOW'));
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

// ── precision regressions from the 2026-08-28 famous-repo sweep, round 2 ──────

test('SILENT_SWALLOW: a catch body with ANY comment is a documented decision — NOT flagged', () => {
  // axios lib/adapters/http.js shape: explanation in the developer's own words,
  // not our magic phrases. Demanding our words instead of accepting theirs is noise.
  const src = `options.beforeRedirects.auth = function beforeRedirectAuth(redirectOptions) {
  try {
    redirectOptions.auth = authToRestore;
  } catch (e) {
    // ignore malformed URL: leaving auth stripped is fail-safe
  }
};`;
  assert.ok(!rules('lib/http.js', src).includes('SILENT_SWALLOW'));
});

test('SILENT_SWALLOW: a completely EMPTY multi-line catch in context IS flagged', () => {
  const src = `try { await sendPaymentConfirmed(id); } catch (e) {
}`;
  assert.ok(rules('lib/billing.ts', src).includes('SILENT_SWALLOW'));
});

test('TAUTOLOGY: a test TITLE containing "duplicate ... in" is a string — NOT flagged', () => {
  // got test/hooks.ts shape: the title is prose in a string literal, not a
  // confession of re-implementing production code.
  const src = `import got from '../source/index.js';
test('no duplicate hook calls in single-page paginated requests', async (t) => {
  t.pass();
});`;
  assert.ok(!rules('test/hooks.test.ts', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: a mirror confession in a COMMENT still fires after string-stripping', () => {
  const src = `// mirrors generateSignature() in payfast.ts — keep in lockstep
function generateSignature(d) { return md5(d); }`;
  assert.ok(rules('test/payfast.test.ts', src).includes('TAUTOLOGY'));
});

// ── TAUTOLOGY precision, 0.3.0 (2026-08-28 monorepo sweep) ───────────────────
// 12 findings across 5 monorepos, all false positives. A local definition is a
// tautology only when the suite ASSERTS ON IT while naming it as the subject.

test('TAUTOLOGY: React fixture component is NOT flagged', () => {
  // react-router __tests__/useNavigate-test.tsx shape. Rendered, never asserted on.
  const src = `import { useNavigate } from "react-router";
describe('useNavigate', () => {
  function Parent() { return <Child />; }
  function Child() { return null; }
  it('navigates', () => { expect(screen.getByText('x')).toBeTruthy(); });
});`;
  assert.ok(!rules('packages/react-router/__tests__/useNavigate-test.tsx', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: a test helper that IS asserted on but is not the subject is NOT flagged', () => {
  const src = `import { z } from "zod";
function bundle(entry) { return build(entry); }
describe('tree shaking', () => {
  it('is small', async () => { expect(await bundle('a')).toBeLessThan(100); });
});`;
  assert.ok(!rules('packages/treeshake/bundle-size.test.ts', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: local copy that IS the subject and IS asserted on IS flagged', () => {
  // The real STB03 shape: the suite says it tests engineLabel, and asserts
  // against its own copy rather than the shipped one.
  const src = `import { describe, it, expect } from 'vitest';
function engineLabel(engine) {
  const map = { deepgram: 'Deepgram' };
  return map[engine] ?? engine;
}
describe('engineLabel handles modern engine names', () => {
  it('maps deepgram', () => { expect(engineLabel('deepgram')).toBe('Deepgram'); });
});`;
  assert.ok(rules('test/stability.test.ts', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: importing the real implementation by PACKAGE NAME is not a confession', () => {
  // The monorepo shape the old relative-import guard could not see.
  const src = `import { engineLabel } from "@app/core";
describe('engineLabel', () => {
  it('maps', () => { expect(engineLabel('deepgram')).toBe('Deepgram'); });
});`;
  assert.ok(!rules('packages/core/__tests__/engineLabel.test.ts', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: prose in a comment is not a confession without a code target', () => {
  // vite/vue shapes: "duplicate exports are removed (in", "mirrors the dev-server order in"
  const a = `// duplicate exports are removed (in the output bundle)
import { build } from "vite";`;
  const b = `// mirrors the dev-server order in practice
import { createServer } from "vite";`;
  assert.ok(!rules('packages/vite/src/node/__tests__/x.spec.ts', a).includes('TAUTOLOGY'));
  assert.ok(!rules('packages/vite/src/node/__tests__/y.spec.ts', b).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: a confession naming a real code target still fires', () => {
  const src = `// mirrors generateSignature() in payfast.ts — keep in lockstep
function generateSignature(d) { return md5(d); }`;
  assert.ok(rules('test/payfast.test.ts', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: a lowercase helper matching PROSE in a title is NOT flagged', () => {
  // zod to-json-schema.test.ts shape: `required` is a local arrow helper, and the
  // titles say "adds required" / "stays required" as ordinary English.
  const src = `import { z } from "zod";
const required = (schema) => Object.keys(schema.shape);
test("record with enum keys adds required", () => {
  expect(required(z.object({}))).toEqual([]);
});`;
  assert.ok(!rules('packages/zod/tests/to-json-schema.test.ts', src).includes('TAUTOLOGY'));
});

test('TAUTOLOGY: lowercase name written as a CALL in the title IS flagged', () => {
  // trpc errors.test.ts shape: `test('getMessageFromUnknownError()')` — the title
  // names it as a function, which is a subject declaration, not prose.
  const src = `import { isObject } from "@trpc/server";
function unwrap(err, fallback) { return typeof err === 'string' ? err : fallback; }
test('unwrap()', () => {
  expect(unwrap('a', 'b')).toBe('a');
});`;
  assert.ok(rules('packages/tests/server/errors.test.ts', src).includes('TAUTOLOGY'));
});

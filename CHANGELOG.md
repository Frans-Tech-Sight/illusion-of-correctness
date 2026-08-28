# Changelog

## 0.3.0 — 2026-08-28

TAUTOLOGY precision. 0.2.0's sweep scanned only `src`/`lib`, but TAUTOLOGY fires
only on test files — so that sweep structurally could not exercise it. A scan
reaching `packages/**/__tests__` across 20 repos produced 12 findings, every one
a false positive.

- **A local definition is now a tautology only when the suite ASSERTS ON IT while
  naming it as the subject.** Both signals must coincide. Previously any local
  function named in a title was flagged when the file had no *relative* import —
  but monorepo tests import their own package by name (`from "react-router"`), so
  the guard read "imports nothing" and flagged React fixture components
  (`function Parent()`) and ordinary helpers (`shuffle`, `bundle`, `request`).
- **A title reference must identify something.** A bare lowercase word matches
  English prose: vue's `test('ts module resolve')` and zod's `test('...adds
  required')` matched local helpers called `resolve` and `required`. A title now
  counts only for a distinctive identifier (camelCase/underscore/leading capital)
  or a name written as a call — `getMessageFromUnknownError()`.
- **A confession must name a code target.** `mirrors checkBalance() in
  payfast.ts` counts; `duplicate exports are removed (in` (vite) and `mirrors the
  dev-server order in` (vue) do not.
- **Contract change, deliberate:** a local function that is described but never
  asserted on is no longer TAUTOLOGY. That is a vacuous test — a different
  defect — and treating it as tautological is what flagged fixture components.
  Both directions are pinned by tests.

Result across 20 well-known repos: **12 false positives -> 1 finding, and that
one is a true positive** (trpc `packages/tests/server/errors.test.ts` defines
`getMessageFromUnknownError` at line 22 and asserts against that local copy under
`test('getMessageFromUnknownError()')` — the test cannot fail if trpc's real
error handling breaks). 43 tests; the new ones fail against 0.2.0.

## 0.2.0 — 2026-08-28

Precision release. A sweep of eight well-known repos (express, axios, lodash,
fastify, got, date-fns, chalk, webpack) against 0.1.0 produced 46 findings, and
every hand-checked one was a deliberate ignore, a test-file catch, or a match
inside a string literal. A correctness tool that cries wolf on famous code
refutes itself, so 0.2.0 trades recall for precision. The same sweep now
returns zero findings; the known-defect fixtures still light up.

- **Scanner: string/template-literal immunity.** Patterns no longer match inside
  string or template literals (multi-line templates tracked), nor inside line
  comments. 0.1.0 reported `catch(e) {}` living inside a string of embedded
  runtime JS in webpack as a finding in webpack's source.
- **SILENT_SWALLOW narrowed to its post-mortem.** Fires only in
  money/access/notification context, never in test files (a catch there is often
  the assertion), never for bare `catch {}` or `_`-prefixed bindings (the
  ecosystem's deliberate-ignore conventions), and never when the catch body
  carries a comment — any comment is a documented decision; the rule no longer
  demands its own magic words.
- **TAUTOLOGY mirror scan ignores strings.** A test *title* like
  'no duplicate hook calls in single-page paginated requests' is prose, not a
  confession of re-implementing production code. Comments are still read —
  that's where real "mirrors X in Y" confessions live.
- 12 new regression tests, each verified to FAIL against 0.1.0 (34 total).

## 0.1.0 — 2026-08-25

Initial release.

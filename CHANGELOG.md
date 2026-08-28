# Changelog

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

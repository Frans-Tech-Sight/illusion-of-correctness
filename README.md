# illusion-of-correctness

**Find the defects that survive a green test suite.**

Linters check syntax. Test runners check that tests pass — which is precisely the lie. This
tool looks for the narrow, nasty family of bugs where everything is green and the code still
does not do what it claims.

```bash
npx illusion-of-correctness ./src
```

No install, no config, no dependencies, no network. See [SECURITY.md](./SECURITY.md).

## Why this exists

AI now writes a large share of committed code, and it fails differently from human code. It
produces work that *looks* right, *reviews* right and *tests* green — then behaves differently
in production. Each rule below comes from a real defect that shipped past a full passing test
suite and human review.

## What it finds

| Rule | Severity | The bug |
|---|---|---|
| `FAIL_OPEN` | high | A permission or entitlement check that returns "allow" when **its own lookup failed**. Query the wrong column, the query errors, the row comes back empty — and the gate lets everyone through. Tests never see it, because tests supply data. |
| `NULLISH_CMP` | high | `x ?? 0 > 0` parses as `x ?? (0 > 0)`. `??` binds looser than `>`, so the comparison you wrote never happens — and a negative number is truthy. |
| `TAUTOLOGY` | high | A test that **re-implements the code it tests**. It measures its own copy, so it stays green forever while the real implementation is broken. The most dangerous passing test there is. |
| `LOST_ASYNC` | medium | Fire-and-forget work started with `void` immediately before sending a response. On a short-lived or serverless handler the context can freeze at response time and the work never completes — so the write silently never lands. |
| `SILENT_SWALLOW` | low | An empty `catch` that discards the error, making the failure unobservable. Say the swallow is deliberate in a comment and the rule stands down. |

## Usage

```bash
illusion                      # scan the current directory
illusion ./src                # scan a path
illusion --min=high           # only the strongest signals
illusion --json               # machine-readable, for CI
illusion --no-exit-code       # never fail the build
```

Exits `1` when findings exist, so it works as a CI gate:

```yaml
- run: npx illusion-of-correctness ./src --min=high
```

Suppress an accepted case by putting `illusion-ignore` on the line, or the line above it.

## Programmatic use

```js
import { analyse, RULES } from 'illusion-of-correctness';

const findings = analyse('api/gate.ts', sourceText);
// [{ rule: 'FAIL_OPEN', file: 'api/gate.ts', line: 12, snippet: '...' }]
```

`analyse()` is pure: source text in, findings out. No I/O, no network.

## What this is not

Findings are **signals, not verdicts** — read the code before acting on one. And an empty
result does **not** mean your code is correct or secure: this detects one specific family of
defects, and is not a linter, a security scanner, or a substitute for review and testing.

## Licence

MIT © Tech Sight (Pty) Ltd. Provided without warranty — see [LICENSE](./LICENSE).

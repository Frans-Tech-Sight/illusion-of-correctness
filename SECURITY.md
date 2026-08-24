# Security and privacy

This tool reads source code, which is often the most sensitive asset an organisation has.
The guarantees below are deliberately narrow, verifiable, and enforced by tests.

## What it does not do

- **No network access.** It makes no HTTP requests, opens no sockets, and contacts no server —
  ours or anyone else's. There is no "phone home", no licence check, no update ping.
- **No telemetry.** Nothing about you, your code, your findings, or your usage is collected,
  transmitted, or stored anywhere outside your machine.
- **No dependencies.** `dependencies` is empty. Nothing else is pulled into your tree, so the
  package cannot become an attack path through a compromised transitive dependency.
- **No writes.** It never modifies, creates, or deletes the files it scans. It is read-only.
- **No remote scanning.** It analyses local source you already have. It cannot probe, attack,
  or test a third-party system, by design.

## How to verify these claims yourself

Do not take our word for it:

```bash
# 1. Read it. The whole tool is two small files with no build step.
cat node_modules/illusion-of-correctness/src/rules.mjs
cat node_modules/illusion-of-correctness/bin/illusion.mjs

# 2. Confirm there are no dependencies.
npm ls --all illusion-of-correctness

# 3. Watch it make no network calls.
#    (Linux) run it with networking denied and confirm identical output:
unshare -rn node bin/illusion.mjs ./src
```

The test suite contains a check that fails the build if the analysis engine ever references
`node:fs`, `node:net`, `node:http`, `node:https`, `node:child_process`, `fetch`, or
`XMLHttpRequest`. That guarantee is mechanically enforced, not merely promised.

## Scope of the findings

Findings are **signals, not verdicts**. Every rule is a heuristic over source text, so:

- A finding is not proof of a defect. Read the code before acting on it.
- The absence of findings is **not** proof that code is correct or secure. This tool detects a
  specific, narrow family of defects. It is not a security scanner, a linter, or a substitute
  for testing, review, or a real audit.

Use `--min=high` to see only the rules with the strongest signal, and put `illusion-ignore` on
a line (or the line above) to suppress an accepted case.

## Reporting a vulnerability

If you find a security issue in this tool, please open a
[security advisory](https://github.com/Frans-Tech-Sight/illusion-of-correctness/security/advisories/new)
rather than a public issue. We aim to acknowledge within 5 working days.

Please do **not** report vulnerabilities you find in *your own or a third party's* code here —
this repository is only for defects in the tool itself.

## Liability

This software is provided under the MIT Licence, **without warranty of any kind**, express or
implied. See [LICENSE](./LICENSE). You are responsible for verifying any finding before acting
on it, and for the security of the code you write.

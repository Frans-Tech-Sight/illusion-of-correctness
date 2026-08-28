/**
 * Detection rules for the illusion of correctness: defects that survive a green test suite.
 *
 * SAFETY: this module is pure. It takes source text in and returns findings out. It performs
 * no I/O of its own, opens no network connections, and never writes to disk. See SECURITY.md.
 */

/** Words suggesting a block is an authorisation / entitlement / validation decision. */
const GATE_WORDS =
  /(auth|permission|entitle|balance|quota|credit|licen[cs]e|subscri|access|allow|deny|verify|validate|gate|guard|limit|plan|tier|paywall|billing)/i;

/** A comment that states the swallow/omission is deliberate. Respected, not second-guessed. */
const DELIBERATE =
  /(deliberate|intentional|on purpose|by design|fire-and-forget|best[- ]effort|never propagate|ignore[ds]? on purpose|safe to ignore|noop|no-op)/i;

const IGNORE_DIRECTIVE = /illusion-ignore/;

export const RULES = {
  FAIL_OPEN: {
    severity: 'high',
    title: 'Gate proceeds when its own lookup failed',
    why: 'A permission or entitlement check that returns a permissive value on error is skipped entirely whenever the lookup breaks. The gate fails OPEN, and nothing in a test suite reveals it.',
  },
  NULLISH_CMP: {
    severity: 'high',
    title: 'Nullish coalescing binds looser than the comparison',
    why: '`x ?? 0 > 0` parses as `x ?? (0 > 0)`. Any non-nullish value passes through unchanged, and a negative number is truthy — so the comparison you intended never happens.',
  },
  LOST_ASYNC: {
    severity: 'medium',
    title: 'Fire-and-forget work immediately before a response',
    why: 'On a short-lived or serverless handler the execution context can be frozen the moment the response is sent, so background work started with `void` may never complete. Await it, or move it before the response.',
  },
  TAUTOLOGY: {
    severity: 'high',
    title: 'Test re-implements the code it is testing',
    why: 'A test that defines its own copy of the logic measures that copy, not the product. It stays green while the real implementation is broken — the most dangerous kind of passing test.',
  },
  SILENT_SWALLOW: {
    severity: 'low',
    title: 'Error discarded with no record in a path that moves money or access',
    why: 'An empty catch in payment, auth or notification code makes the failure unobservable — the incident class where a dead email path or a skipped credit stays invisible for months. Bare `catch {}`, `_`-prefixed bindings, and any catch body carrying a comment are respected as deliberate decisions.',
  },
};

/**
 * Where a silently swallowed error is dangerous enough to flag. Precision over
 * recall, measured 2026-08-28: an unrestricted empty-catch rule produced 46
 * findings across eight well-known repos, and every hand-checked one was a
 * deliberate ignore (feature detection, `_err` convention, catch-as-assertion
 * in tests). A correctness tool that cries wolf on famous code refutes itself,
 * so this rule now fires only where the post-mortems it came from lived:
 * money, entitlement, and outbound-notification paths.
 */
const SWALLOW_CONTEXT =
  /(payment|payout|refund|credit|debit|charge|billing|invoice|itn|webhook|notif|email|mail|sms|auth|entitle|balance|quota|licen[cs]e|subscri|paywall)/i;

/**
 * Catch bindings that already SAY "ignored on purpose": no binding at all
 * (`catch {`), or an `_`-prefixed name (`catch (_err)`) — both ecosystem
 * conventions. Flagging them is noise, and noise gets a checker uninstalled.
 */
function catchBindingIsDeliberate(line) {
  const m = /catch\s*(?:\(\s*([A-Za-z_$][\w$]*)?[^)]*\))?\s*\{/.exec(line);
  if (!m) return false;
  const binding = m[1];
  if (!binding) return true;          // bare catch — deliberate by convention
  return binding.startsWith('_');     // _err / _ — deliberate by convention
}

/**
 * Blank out the CONTENTS of string and template literals so patterns never
 * match inside them, while preserving line length (line numbers and snippets
 * stay true). Tracks multi-line template literals across calls via `state`.
 * Measured failure this fixes: webpack CssLoadingRuntimeModule.js embeds
 * runtime JS in a string — `catch(e) {}` inside it was reported as a finding
 * in webpack's own source. It is not webpack's source; it is a string.
 */
export function stripStringLiterals(line, state = { inTemplate: false }, opts = {}) {
  let out = '';
  let i = 0;
  let mode = state.inTemplate ? '`' : null; // null | "'" | '"' | '`'
  while (i < line.length) {
    const c = line[i];
    if (mode) {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === mode) { out += c; mode = null; i++; continue; }
      out += ' ';
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { mode = c; out += c; i++; continue; }
    // line comment: keep the marker, blank the text — comments sometimes QUOTE
    // buggy code (`catch {}` in an explanation) and must never match as code.
    // The raw line, not this sanitized copy, is what the comment-aware logic
    // (DELIBERATE, ignore directives) reads. With keepComments, comment text
    // survives — the TAUTOLOGY mirror scan needs comments ("mirrors X in Y")
    // while still ignoring string literals (test TITLES are strings).
    if (c === '/' && line[i + 1] === '/') {
      out += opts.keepComments ? line.slice(i) : '//' + ' '.repeat(Math.max(0, line.length - i - 2));
      break;
    }
    out += c;
    i++;
  }
  // ' and " do not span lines; only a template literal carries over
  state.inTemplate = mode === '`';
  return out;
}

const isTestPath = (file) => {
  const p = String(file).replace(/\\/g, '/');
  return /\.(test|spec)\./.test(p) || /(^|\/)(tests?|__tests__)\//.test(p);
};

/**
 * Analyse one file's source.
 * @param {string} file  path used only for reporting and test-file detection
 * @param {string} src   file contents
 * @returns {Array<{rule:string,file:string,line:number,snippet:string}>}
 */
export function analyse(file, src) {
  const out = [];
  if (typeof src !== 'string' || !src) return out;
  const lines = src.split('\n');
  const test = isTestPath(file);
  const push = (rule, line, snippet) =>
    out.push({ rule, file, line, snippet: String(snippet).trim().slice(0, 160) });

  // One pass to sanitize every line: string/template contents blanked, comment
  // text blanked, line numbers preserved. Patterns match ONLY sanitized code;
  // raw lines are kept for snippets and for the comment-reading logic.
  const stripState = { inTemplate: false };
  const code = lines.map((l) => stripStringLiterals(l, stripState));

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];        // raw — snippets, DELIBERATE, ignore directives
    const C = code[i];         // sanitized — all structural pattern matching
    const ln = i + 1;
    if (IGNORE_DIRECTIVE.test(L) || (i > 0 && IGNORE_DIRECTIVE.test(lines[i - 1]))) continue;

    // NULLISH_CMP — unparenthesised `?? n <cmp>`
    if (/\?\?\s*-?\d+(?:\.\d+)?\s*(?:>=|<=|>|<)(?!=)/.test(C)) push('NULLISH_CMP', ln, L);

    // SILENT_SWALLOW — empty catch, or a catch whose body is only comments.
    // Precision constraints (2026-08-28 sweep): never in test files (a catch is
    // often the assertion there), never for bare/`_`-prefixed bindings (the
    // deliberate-ignore conventions), and only in money/access/notification
    // context — the incident class this rule was distilled from.
    if (!test && !catchBindingIsDeliberate(C)) {
      const swallowCtx = lines.slice(Math.max(0, i - 25), i + 3).join('\n');
      if (SWALLOW_CONTEXT.test(swallowCtx)) {
        if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(C)) {
          if (!DELIBERATE.test(L)) push('SILENT_SWALLOW', ln, L);
        } else if (/catch\s*(?:\([^)]*\))?\s*\{\s*$/.test(C)) {
          // Multi-line catch: flag only a body that is completely EMPTY. A body
          // containing any comment at all is a documented decision — axios's
          // "// ignore malformed URL: leaving auth stripped is fail-safe" is an
          // explanation, and demanding OUR magic words instead of accepting
          // theirs is how a checker becomes noise (2026-08-28 sweep).
          let j = i + 1, empty = true, closed = false;
          for (; j < lines.length && j < i + 10; j++) {
            const t = lines[j].trim();
            if (t === '}') { closed = true; break; }
            if (t) { empty = false; break; }
          }
          if (closed && empty) push('SILENT_SWALLOW', ln, L);
        }
      }
    }

    // LOST_ASYNC — `void asyncThing(...)` with a response sent shortly after
    if (/^\s*void\s+[A-Za-z_$][\w$.]*\s*\(/.test(C)) {
      const ahead = code.slice(i, Math.min(i + 12, code.length)).join('\n');
      if (/return\s+res\.|res\.(?:json|send|end|status)\s*\(|return\s+new\s+Response|return\s+Response\./.test(ahead)) {
        push('LOST_ASYNC', ln, L);
      }
    }

    if (!test) {
      // Context is read RAW on purpose: a comment saying "balance gate" is a
      // legitimate scoping signal. Only the defect PATTERNS use sanitized code.
      const ctx = lines.slice(Math.max(0, i - 25), i + 3).join('\n');
      const ctxCode = code.slice(Math.max(0, i - 25), i + 3).join('\n');

      // FAIL_OPEN — `if (err) return <permissive>` inside a gate
      if (/if\s*\(\s*!?\s*(?:\w*[Ee]rr\w*|error)\b[^)]*\)\s*\{?\s*return\s+(?:null|true|undefined)\s*;?/.test(C) && GATE_WORDS.test(ctx)) {
        push('FAIL_OPEN', ln, L);
      }
      // FAIL_OPEN — missing record treated as authorised, right after a lookup
      if (/if\s*\(\s*!\s*(?:data|profile|row|record|user|account|sub\w*)\s*\)\s*\{?\s*return\s+(?:null|true)\s*;?/.test(C)
        && GATE_WORDS.test(ctx)
        && /\.(?:select|from|single|maybeSingle|findOne|findUnique|get)\s*\(/.test(ctxCode)) {
        push('FAIL_OPEN', ln, L);
      }
    }
  }

  // TAUTOLOGY — a test that mirrors production logic instead of importing it.
  // The mirror scan runs on string-stripped text with comments KEPT: the honest
  // confession ("mirrors generateSignature() in payfast.ts") lives in comments,
  // while test TITLES are string literals — got's 'no duplicate hook calls in
  // single-page paginated requests' matched the old raw-source scan.
  if (test) {
    const st = { inTemplate: false };
    const srcNoStrings = lines.map((l) => stripStringLiterals(l, st, { keepComments: true })).join('\n');
    // A confession must name a CODE target — `checkBalance()` or `payfast.ts`.
    // Requiring only a following "in"/"from" matched ordinary prose in real test
    // titles and comments: "duplicate exports are removed (in" (vite),
    // "mirrors the dev-server order in" (vue). Neither is a re-implementation.
    const mirror = /\b(?:mirrors?|mirroring|re-?implements?|duplicates?|(?:local |inline )?copy of|same logic as)\b[^\n]{0,60}?(?:[A-Za-z_$][\w$]*\s*\(\s*\)|[\w./-]+\.[tj]sx?\b)/i.exec(srcNoStrings);
    if (mirror && !IGNORE_DIRECTIVE.test(src)) {
      push('TAUTOLOGY', src.slice(0, mirror.index).split('\n').length, mirror[0]);
    }

    // A local definition is a TAUTOLOGY only when the suite ASSERTS ON IT while
    // claiming to test it. Two signals must coincide:
    //   (a) the function is called directly inside an assertion —
    //       `expect(engineLabel(x))`, not `<Parent />`;
    //   (b) its name appears in a describe/it title, i.e. the suite says this is
    //       the subject under test, not a helper.
    //
    // The previous heuristic — "flag any local function named in a title when the
    // file imports nothing RELATIVE" — produced 12 findings across 5 monorepos on
    // 2026-08-28, every one a false positive. Monorepo tests import their own
    // package by NAME (`from "react-router"`), so the relative-import guard read
    // "imports nothing", and React fixture components (`function Parent()`) plus
    // ordinary helpers (`shuffle`, `bundle`, `request`) were all flagged.
    const localFns = new Set();
    for (const m of srcNoStrings.matchAll(/^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      localFns.add(m[1]);
    }
    for (const m of srcNoStrings.matchAll(/^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm)) {
      localFns.add(m[1]);
    }

    for (const fn of localFns) {
      // (a) asserted upon directly
      const asserted = new RegExp(
        `(?:expect|assert(?:\\.[\\w$]+)?|t\\.[\\w$]+|should)\\s*\\(\\s*(?:await\\s+)?${fn}\\s*\\(`,
      ).test(srcNoStrings);
      if (!asserted) continue;

      // (b) declared as the SUBJECT in a title — and the name must actually
      // identify something. A bare lowercase word matches ordinary English prose:
      // vue's `test('ts module resolve')` and zod's `test('...adds required')`
      // both matched local helpers named `resolve` and `required` and produced
      // false positives (2026-08-28). Accept a title reference only when the name
      // is a distinctive identifier (camelCase / underscore / leading capital) or
      // is written as a call — `getMessageFromUnknownError()`.
      const looksLikeIdentifier = /[A-Z_]/.test(fn);
      const titleWord = new RegExp(`(?:describe|it|test)\\s*\\(\\s*['"\`][^'"\`]*\\b${fn}\\b`, 'i');
      const titleCall = new RegExp(`(?:describe|it|test)\\s*\\(\\s*['"\`][^'"\`]*\\b${fn}\\s*\\(`, 'i');
      const described = titleCall.test(src) || (looksLikeIdentifier && titleWord.test(src));
      if (!described) continue;

      const decl = new RegExp(`^[ \\t]*(?:export\\s+)?(?:async\\s+)?(?:function\\s+${fn}\\b|(?:const|let|var)\\s+${fn}\\s*=)`, 'm');
      const at = decl.exec(srcNoStrings);
      if (at) push('TAUTOLOGY', srcNoStrings.slice(0, at.index).split('\n').length, `${fn}(...) defined locally and asserted upon`);
    }
  }

  // de-duplicate identical rule+line
  const seen = new Set();
  return out.filter((f) => {
    const k = `${f.rule}:${f.line}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

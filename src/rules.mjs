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
    title: 'Error discarded with no record',
    why: 'An empty catch makes the failure unobservable. If it is deliberate, say so in a comment and this rule will stand down.',
  },
};

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

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const ln = i + 1;
    if (IGNORE_DIRECTIVE.test(L) || (i > 0 && IGNORE_DIRECTIVE.test(lines[i - 1]))) continue;

    // NULLISH_CMP — unparenthesised `?? n <cmp>`
    if (/\?\?\s*-?\d+(?:\.\d+)?\s*(?:>=|<=|>|<)(?!=)/.test(L)) push('NULLISH_CMP', ln, L);

    // SILENT_SWALLOW — empty catch, or a catch whose body is only comments
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(L)) {
      if (!DELIBERATE.test(L)) push('SILENT_SWALLOW', ln, L);
    } else if (/catch\s*(?:\([^)]*\))?\s*\{\s*$/.test(L)) {
      let j = i + 1, onlyComments = true, closed = false, deliberate = false;
      for (; j < lines.length && j < i + 10; j++) {
        const t = lines[j].trim();
        if (t === '}') { closed = true; break; }
        if (DELIBERATE.test(t)) deliberate = true;
        if (t && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*')) { onlyComments = false; break; }
      }
      if (closed && onlyComments && !deliberate) push('SILENT_SWALLOW', ln, L);
    }

    // LOST_ASYNC — `void asyncThing(...)` with a response sent shortly after
    if (/^\s*void\s+[A-Za-z_$][\w$.]*\s*\(/.test(L)) {
      const ahead = lines.slice(i, Math.min(i + 12, lines.length)).join('\n');
      if (/return\s+res\.|res\.(?:json|send|end|status)\s*\(|return\s+new\s+Response|return\s+Response\./.test(ahead)) {
        push('LOST_ASYNC', ln, L);
      }
    }

    if (!test) {
      const ctx = lines.slice(Math.max(0, i - 25), i + 3).join('\n');

      // FAIL_OPEN — `if (err) return <permissive>` inside a gate
      if (/if\s*\(\s*!?\s*(?:\w*[Ee]rr\w*|error)\b[^)]*\)\s*\{?\s*return\s+(?:null|true|undefined)\s*;?/.test(L) && GATE_WORDS.test(ctx)) {
        push('FAIL_OPEN', ln, L);
      }
      // FAIL_OPEN — missing record treated as authorised, right after a lookup
      if (/if\s*\(\s*!\s*(?:data|profile|row|record|user|account|sub\w*)\s*\)\s*\{?\s*return\s+(?:null|true)\s*;?/.test(L)
        && GATE_WORDS.test(ctx)
        && /\.(?:select|from|single|maybeSingle|findOne|findUnique|get)\s*\(/.test(ctx)) {
        push('FAIL_OPEN', ln, L);
      }
    }
  }

  // TAUTOLOGY — a test that mirrors production logic instead of importing it
  if (test) {
    const mirror = /\b(?:mirrors?|mirroring|re-?implement\w*|duplicat\w+|(?:local |inline )?copy of|same logic as)\b[^\n]{0,80}?(?:\bin\b|\bfrom\b|\.[tj]sx?\b)/i.exec(src);
    if (mirror && !IGNORE_DIRECTIVE.test(src)) {
      push('TAUTOLOGY', src.slice(0, mirror.index).split('\n').length, mirror[0]);
    }
    // A locally defined function is only suspicious when the suite imports NOTHING from
    // source. If the real module is imported, local functions are ordinary test helpers —
    // flagging those is how a checker becomes noise and gets switched off.
    const importsSource = /import[^;]*from\s*['"](?:\.\.?\/)[^'"]*['"]/.test(src);
    if (!importsSource) {
      for (const m of src.matchAll(/^[ \t]*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
        const fn = m[1];
        const described = new RegExp(`(?:describe|it|test)\\s*\\(\\s*['"\`][^'"\`]*\\b${fn}\\b`, 'i');
        if (described.test(src)) {
          push('TAUTOLOGY', src.slice(0, m.index).split('\n').length, `function ${fn}(...)`);
        }
      }
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

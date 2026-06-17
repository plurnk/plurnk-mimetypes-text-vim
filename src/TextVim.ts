import { BaseHandler } from "@plurnk/plurnk-mimetypes";
import type { HandlerContent, MimeRef, MimeSymbol } from "@plurnk/plurnk-mimetypes";

// text/x-vim handler (Tier 4 hand-roll, symbols only).
//
// Vimscript has no usable tree-sitter grammar: the only faithful one
// (tree-sitter-grammars/tree-sitter-vim) generates a 33k-line lexer that V8
// OOM-aborts the host process on any parse — uncatchable, and a portability
// violation we won't ship (plurnk-mimetypes#0 probe, 2026-06-12). It also
// silently drops vim9 `def` functions. A line-oriented scanner has NEITHER
// problem and is strictly more robust for the radar/outline use: declarations
// are keyword-prefixed lines, honestly parseable in well under the family's
// hand-roll threshold.
//
// Emits (with 1-indexed line/endLine/column):
//   function! [scope:]Name( / def Name(  → function   (span to endfunction/enddef)
//   command! [-flags] Name                → function   (user commands are callable)
//   augroup Name                          → module     (span to `augroup END`)
//   let g:/s:Name, var Name               → variable
//   const/final Name                      → constant   (vim9)
//
// Heredocs (`let x =<< END`, `python3 << EOF`) are skipped to their closing
// marker so embedded script bodies never leak false symbols — the exact case
// that corrupts the tree-sitter grammar. Comment lines (`"` first) and blanks
// are ignored. References are deferred with the grammar (the channel stays
// empty); symbols are what the outline needs.
export default class TextVim extends BaseHandler {
    override extractRaw(content: HandlerContent): MimeSymbol[] {
        const text = typeof content === "string"
            ? content
            : new TextDecoder("utf-8").decode(content);
        return scan(text);
    }

    // References channel (SPEC §16). Hand-rolled like the symbols scan: the
    // unambiguous call form is the `call <Name>(` statement, so v1 captures
    // exactly those — they join to local `function!`/`def` defs; built-ins
    // (`call append(...)`) are honest dead rows. Container is the enclosing
    // function. Expression-position and vim9 implicit calls (`Foo()` with no
    // `call`) are deferred — precision over recall. Same heredoc/comment
    // skipping as the symbol scan, so string/comment content never surfaces.
    override references(content: HandlerContent): MimeRef[] {
        const text = typeof content === "string"
            ? content
            : new TextDecoder("utf-8").decode(content);
        return scanRefs(text);
    }
}

// Keyword abbreviation patterns — Vim accepts any prefix down to the listed
// minimum (`fu`, `com`, `aug`, `endf`).
const RE_FUNCTION = /^\s*fu(?:n(?:c(?:t(?:i(?:o(?:n)?)?)?)?)?)?!?\s+(\S+?)\s*\(/d;
const RE_DEF = /^\s*def!?\s+(\S+?)\s*\(/d;
const RE_END_FN = /^\s*(?:endf(?:u(?:n(?:c(?:t(?:i(?:o(?:n)?)?)?)?)?)?)?|enddef)\b/;
const RE_COMMAND = /^\s*com(?:m(?:a(?:n(?:d)?)?)?)?!?\s+(.+)$/;
const RE_AUGROUP = /^\s*aug(?:r(?:o(?:u(?:p)?)?)?)?\s+(\S+)/d;
const RE_LET = /^\s*let\s+([gs]:[A-Za-z_]\w*)/d;
const RE_VAR = /^\s*(var|const|final)\s+([A-Za-z_]\w*)/d;
// Heredoc opener: `=<< [trim] [eval] MARKER` (list assignment) or
// `<< MARKER` (embedded script). MARKER is a bare word ending the line.
const RE_HEREDOC = /(?:=<<|<<)\s*(?:trim\s+)?(?:eval\s+)?([A-Za-z_]\w*)\s*$/;

function scan(text: string): MimeSymbol[] {
    const lines = text.split("\n");
    const out: MimeSymbol[] = [];
    let pendingFn = -1;       // index in `out` of an open function/def
    let pendingAug = -1;      // index in `out` of an open augroup
    let heredoc: string | null = null;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineNo = i + 1;

        if (heredoc !== null) {
            if (line.trim() === heredoc) heredoc = null;
            continue;
        }

        const lead = line.trimStart();
        if (lead.length === 0 || lead.startsWith('"')) continue;

        // Close an open function/def first — `endfunction` carries no symbol.
        if (RE_END_FN.test(line)) {
            if (pendingFn >= 0) { out[pendingFn].endLine = lineNo; pendingFn = -1; }
            continue;
        }

        let matched = false;

        const aug = RE_AUGROUP.exec(line);
        if (aug) {
            matched = true;
            const name = aug[1];
            if (name.toUpperCase() === "END") {
                if (pendingAug >= 0) { out[pendingAug].endLine = lineNo; pendingAug = -1; }
            } else {
                out.push(sym("module", name, lineNo, col(aug, 1)));
                pendingAug = out.length - 1;
            }
        }

        if (!matched) {
            const fn = RE_FUNCTION.exec(line) ?? RE_DEF.exec(line);
            if (fn) {
                matched = true;
                out.push(sym("function", fn[1], lineNo, col(fn, 1)));
                pendingFn = out.length - 1;
            }
        }

        if (!matched) {
            const cmd = RE_COMMAND.exec(line);
            if (cmd) {
                const named = commandName(cmd[1]);
                if (named) {
                    matched = true;
                    out.push(sym("function", named.name, lineNo, leadCol(line) + named.offset));
                }
            }
        }

        if (!matched) {
            const lt = RE_LET.exec(line);
            if (lt) {
                matched = true;
                out.push(sym("variable", lt[1], lineNo, col(lt, 1)));
            }
        }

        if (!matched) {
            const v = RE_VAR.exec(line);
            if (v) {
                matched = true;
                const kind = v[1] === "var" ? "variable" : "constant";
                out.push(sym(kind, v[2], lineNo, col(v, 2)));
            }
        }

        // After emitting any symbol on this line, a trailing heredoc opener
        // (`let g:list =<< END`) starts skipping the body on following lines.
        const hd = RE_HEREDOC.exec(line);
        if (hd) heredoc = hd[1];
    }

    // Truncated file: an unclosed function/augroup spans to the last line.
    if (pendingFn >= 0) out[pendingFn].endLine = lines.length;
    if (pendingAug >= 0) out[pendingAug].endLine = lines.length;
    return out;
}

// A command line is `Name args...` after optional `-flag` / `-flag=val`
// attributes. The name is the first token that doesn't start with `-`.
function commandName(rest: string): { name: string; offset: number } | null {
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest)) !== null) {
        if (!m[0].startsWith("-")) return { name: m[0], offset: m.index };
    }
    return null;
}

function leadCol(line: string): number {
    // 1-indexed column where `rest` (post-`command! `) begins.
    const m = RE_COMMAND.exec(line);
    if (!m) return 1;
    return line.length - m[1].length + 1;
}

function col(m: RegExpExecArray, group: number): number {
    const idx = m.indices?.[group];
    return idx ? idx[0] + 1 : 1;
}

function sym(kind: MimeSymbol["kind"], name: string, line: number, column: number): MimeSymbol {
    return { name, kind, line, endLine: line, column, endColumn: column + name.length };
}

// A `call` statement: `cal[l] [scope:]Name(`. The name (with its scope prefix,
// so it matches how `function!` defs are stored) is the callee. Anchored at
// line start (after whitespace), so a `call X(` inside a string assignment
// (`let s = "call X("`) — which starts with `let` — is never matched.
const RE_CALL = /^\s*cal(?:l)?\s+((?:<[Ss][Ii][Dd]>|[gsbwtl]:)?[A-Za-z_][\w#]*)\s*\(/d;

function scanRefs(text: string): MimeRef[] {
    const lines = text.split("\n");
    const out: MimeRef[] = [];
    let currentFn: string | null = null; // enclosing function → ref container
    let heredoc: string | null = null;

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const lineNo = i + 1;

        if (heredoc !== null) {
            if (line.trim() === heredoc) heredoc = null;
            continue;
        }
        const lead = line.trimStart();
        if (lead.length === 0 || lead.startsWith('"')) continue;

        if (RE_END_FN.test(line)) { currentFn = null; continue; }

        const fn = RE_FUNCTION.exec(line) ?? RE_DEF.exec(line);
        if (fn) {
            currentFn = fn[1];
            const opener = RE_HEREDOC.exec(line);
            if (opener) heredoc = opener[1];
            continue;
        }

        const c = RE_CALL.exec(line);
        if (c) {
            const written = c[1];
            // <SID>Name and s:Name name the same script-local function — fold
            // to s: so the ref joins the `function! s:Name(` def.
            const name = written.replace(/^<[Ss][Ii][Dd]>/, "s:");
            const column = col(c, 1);
            out.push({
                name,
                kind: "call",
                line: lineNo,
                column,
                endLine: lineNo,
                endColumn: column + written.length,
                ...(currentFn !== null && { container: currentFn }),
            });
        }

        const hd = RE_HEREDOC.exec(line);
        if (hd) heredoc = hd[1];
    }
    return out;
}

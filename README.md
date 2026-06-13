# @plurnk/plurnk-mimetypes-text-vim

`text/x-vim` (Vimscript) mimetype handler for the [plurnk](https://github.com/plurnk) ecosystem. Tier 4 hand-rolled — no parser dependency.

## why hand-rolled

The only faithful tree-sitter Vimscript grammar generates a 33,000-line lexer that V8's optimizer **OOM-aborts the host Node process** on any parse — uncatchable, and a portability violation the family won't ship. It also silently drops vim9 `def` functions. A line-oriented scanner has neither problem: it parses both legacy `function` and vim9 `def`, skips embedded-script heredocs (`python3 << EOF`) so their bodies can't leak false symbols, and degrades cleanly on truncated input.

## what it emits

`extractRaw` → `MimeSymbol[]` with 1-indexed positions:

| construct | kind |
|---|---|
| `function! [scope:]Name(` / `def Name(` | `function` (span to `endfunction`/`enddef`) |
| `command! [-flags] Name` | `function` |
| `augroup Name` … `augroup END` | `module` |
| `let g:Name` / `let s:Name` / `var Name` | `variable` |
| `const Name` / `final Name` (vim9) | `constant` |

Function-local (`l:`), buffer/window/tab (`b:`/`w:`/`t:`) lets and comment lines are skipped. References are deferred until a non-aborting grammar exists.

## license

MIT.

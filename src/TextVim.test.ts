import { describe, it } from "node:test";
import assert from "node:assert/strict";
import TextVim from "./TextVim.ts";

const meta = { mimetype: "text/x-vim", glyph: "📗", extensions: [".vim"] as const };
const h = () => new TextVim(meta);

describe("TextVim — declarations", () => {
    it("legacy functions with scope prefixes and autoload paths", () => {
        const src = [
            "function! s:Setup(opts)",
            "  return 1",
            "endfunction",
            "func g:Global()",
            "endfunc",
            "function! tagman#util#normalize(s) abort",
            "endfunction",
        ].join("\n");
        const syms = h().extractRaw(src);
        const setup = syms.find((s) => s.name === "s:Setup")!;
        assert.equal(setup.kind, "function");
        assert.equal(setup.line, 1);
        assert.equal(setup.endLine, 3);
        assert.equal(setup.column, 11);
        assert.equal(syms.find((s) => s.name === "g:Global")?.endLine, 5);
        assert.equal(syms.find((s) => s.name === "tagman#util#normalize")?.kind, "function");
    });

    it("vim9 def functions — which the tree-sitter grammar silently drops", () => {
        const src = "vim9script\ndef Parse(input: string): list<string>\n  return []\nenddef\n";
        const syms = h().extractRaw(src);
        const parse = syms.find((s) => s.name === "Parse")!;
        assert.equal(parse.kind, "function");
        assert.equal(parse.line, 2);
        assert.equal(parse.endLine, 4);
    });

    it("user commands with attribute flags", () => {
        const src = "command! -nargs=0 -bang MyCmd call s:Run()\ncom -range=% Reformat call s:Fmt()\n";
        const syms = h().extractRaw(src);
        assert.equal(syms.find((s) => s.name === "MyCmd")?.kind, "function");
        assert.equal(syms.find((s) => s.name === "Reformat")?.kind, "function");
        // The command name's column skips the flags.
        const my = syms.find((s) => s.name === "MyCmd")!;
        assert.equal(my.column, "command! -nargs=0 -bang ".length + 1);
    });

    it("augroups span to `augroup END`", () => {
        const src = [
            "augroup MyGroup",
            "  autocmd!",
            "  autocmd BufWritePre * call s:Trim()",
            "augroup END",
        ].join("\n");
        const syms = h().extractRaw(src);
        const g = syms.find((s) => s.name === "MyGroup")!;
        assert.equal(g.kind, "module");
        assert.equal(g.line, 1);
        assert.equal(g.endLine, 4);
        // The autocmds inside are not symbols; `END` is not a symbol.
        assert.equal(syms.length, 1);
    });

    it("global/script let vars and vim9 var/const", () => {
        const src = [
            "let g:plugin_enabled = 1",
            "let s:state = {}",
            "let l:local = 5",
            "let b:buffer_var = 1",
            "var counter = 0",
            "const MAX = 100",
            "final handle = 0",
        ].join("\n");
        const syms = h().extractRaw(src);
        assert.equal(syms.find((s) => s.name === "g:plugin_enabled")?.kind, "variable");
        assert.equal(syms.find((s) => s.name === "s:state")?.kind, "variable");
        assert.equal(syms.find((s) => s.name === "counter")?.kind, "variable");
        assert.equal(syms.find((s) => s.name === "MAX")?.kind, "constant");
        assert.equal(syms.find((s) => s.name === "handle")?.kind, "constant");
        // l: (function-local) and b: (buffer) are runtime, not declarations.
        assert.equal(syms.some((s) => s.name === "l:local"), false);
        assert.equal(syms.some((s) => s.name === "b:buffer_var"), false);
    });
});

describe("TextVim — hand-roll robustness (the grammar's failure modes)", () => {
    it("embedded-script heredocs don't leak false symbols", () => {
        const src = [
            "function! s:Py()",
            "python3 << EOF",
            "def fake_python_func():",
            "    command_decoy = 1",
            "    return 0",
            "EOF",
            "endfunction",
        ].join("\n");
        const syms = h().extractRaw(src);
        // Only the vim function — nothing from the python body.
        assert.deepEqual(syms.map((s) => s.name), ["s:Py"]);
        assert.equal(syms[0].endLine, 7);
    });

    it("list-assignment heredocs skip their body but emit the var", () => {
        const src = [
            "let g:lines =<< trim END",
            "  function NotReal()",
            "  let fake = 1",
            "END",
            "let g:after = 1",
        ].join("\n");
        const syms = h().extractRaw(src);
        assert.deepEqual(syms.map((s) => s.name), ["g:lines", "g:after"]);
    });

    it("comment lines never produce symbols", () => {
        const src = '" function! s:Commented()\n" let g:commented = 1\nlet g:real = 1\n';
        const syms = h().extractRaw(src);
        assert.deepEqual(syms.map((s) => s.name), ["g:real"]);
    });

    it("a truncated function spans to the last line (agents see truncated files)", () => {
        const src = "function! s:Open()\n  let x = 1\n  call foo(";
        const syms = h().extractRaw(src);
        assert.equal(syms[0].name, "s:Open");
        assert.equal(syms[0].endLine, 3);
    });

    it("returns [] for empty input", () => {
        assert.deepEqual(h().extractRaw(""), []);
    });
});

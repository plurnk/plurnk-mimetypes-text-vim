import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertHandlerConformance } from "@plurnk/plurnk-mimetypes/conformance";
import TextVim from "./TextVim.ts";

const metadata = { mimetype: "text/x-vim", glyph: "📗", extensions: [".vim", ".vimrc"] };
const h = () => new TextVim(metadata);

const SRC = `" plugin helpers

function! s:Greet(name) abort
  echom "hello " . a:name
endfunction

function! s:Main() abort
  call s:Greet("world")
  call append(0, "log line")
endfunction

command! Run call s:Main()
`;

describe("TextVim — references (call graph)", () => {
    it("call statements are call edges scoped to the enclosing function", () => {
        const refs = h().references(SRC);
        assert.ok(refs.some((r) => r.name === "s:Greet" && r.kind === "call" && r.container === "s:Main"));
    });

    it("built-in calls are honest dead rows (sourced, never joined)", () => {
        const refs = h().references(SRC);
        assert.ok(refs.some((r) => r.name === "append" && r.container === "s:Main"));
    });

    it("string/comment content never surfaces as a ref", () => {
        const refs = h().references(SRC);
        assert.ok(!refs.some((r) => ["hello", "world", "log", "helpers"].includes(r.name)));
    });

    it("passes the SPEC §16 conformance invariants", async () => {
        await assertHandlerConformance(h(), {
            source: SRC,
            decoyNames: ["hello", "world", "log line", "helpers"],
            expectJoins: [{ refName: "s:Greet", container: "s:Main" }],
            expectRefs: [
                { name: "s:Greet", kind: "call" },
                { name: "append", kind: "call" },
            ],
        });
    });
});

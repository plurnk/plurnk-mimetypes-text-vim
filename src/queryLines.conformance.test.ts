import { describe, it } from "node:test";
import { assertQueryLineConformance } from "@plurnk/plurnk-mimetypes/conformance";
import Handler from "./TextVim.ts";

// #41: BOTH dialects carry real source lines.
const h = new Handler({"mimetype":"text/x-vim","glyph":"📗","extensions":[".vim",".vimrc",".gvimrc","vimrc","gvimrc","_vimrc","_gvimrc"]});
const src = "let g:x = 1\nfunction! F()\nendfunction\n";

describe("#41 query-line conformance (both dialects)", () => {
    it("jsonpath", async () => { await assertQueryLineConformance(h, [{ source: src, dialect: "jsonpath", pattern: "$..*" }]); });
    it("xpath", async () => { await assertQueryLineConformance(h, [{ source: src, dialect: "xpath", pattern: "//*" }]); });
});

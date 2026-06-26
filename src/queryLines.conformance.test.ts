import { describe, it } from "node:test";
import { assertQueryLineConformance } from "@plurnk/plurnk-mimetypes/conformance";
import Handler from "./TextVim.ts";

const h = new Handler({"mimetype":"text/x-vim","glyph":"📗","extensions":[".vim",".vimrc",".gvimrc","vimrc","gvimrc","_vimrc","_gvimrc"]});

describe("#41 query-line conformance", () => {
    it("every structural match carries a source-line span", async () => {
        await assertQueryLineConformance(h, [{ source: "let g:x = 1\nfunction! Greet()\n  echo \"hi\"\nendfunction\n", dialect: "jsonpath", pattern: "$..*" }]);
    });
});

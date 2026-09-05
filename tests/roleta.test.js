"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(raiz, "index.html"), "utf8");
const js = fs.readFileSync(path.join(raiz, "js", "roleta.js"), "utf8");
const css = fs.readFileSync(path.join(raiz, "css", "roleta.css"), "utf8");

test("roleta premium possui contador, status e carteira de prêmios", () => {
  assert.match(html, /id="roleta-giros-count"/);
  assert.match(html, /id="roleta-status"[^>]*aria-live="polite"/);
  assert.match(html, /class="roleta-carteira"/);
  assert.match(css, /ROLETA PREMIUM — v1\.7\.6/);
});

test("roleta apresenta estados de giro e evita conteúdo inseguro", () => {
  assert.match(js, /classList\.toggle\("girando", state\.girando\)/);
  assert.match(js, /function escaparHtml/);
  assert.match(js, /function corSegura/);
  assert.doesNotMatch(js, /alert\(/);
});

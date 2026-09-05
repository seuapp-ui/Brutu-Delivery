"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname, "..");
const servidor = fs.readFileSync(path.join(raiz, "backend", "server.js"), "utf8");
const painel = fs.readFileSync(path.join(raiz, "painel.html"), "utf8");
const gitignore = fs.readFileSync(path.join(raiz, ".gitignore"), "utf8");

test("servidor protege arquivos internos e páginas com nonce", () => {
  assert.match(servidor, /p\.startsWith\("\/tests\/"\)/);
  assert.match(servidor, /p\.startsWith\("\/scripts\/"\)/);
  assert.match(servidor, /servirHtmlComNonce/);
  assert.match(servidor, /script-src 'nonce-\$\{nonce\}' 'strict-dynamic'/);
  assert.doesNotMatch(servidor, /script-src 'self' 'unsafe-inline'/);
});

test("limitação usa IP normalizado pelo proxy e não header bruto", () => {
  assert.match(servidor, /function ipCliente\(req\)/);
  assert.match(servidor, /const ip = ipCliente\(req\)/);
  assert.doesNotMatch(servidor, /const ip = String\(req\.headers\["x-forwarded-for"\]/);
});

test("roleta usa fonte criptográfica e painel escapa fallback legado", () => {
  const inicio = servidor.indexOf("function sortearPremio");
  const fim = servidor.indexOf('app.get("/api/roleta/config"', inicio);
  const trecho = servidor.slice(inicio, fim);
  assert.match(trecho, /crypto\.randomBytes/);
  assert.doesNotMatch(trecho, /Math\.random/);
  assert.match(painel, /escaparHtml\(p\.produtoPrincipal \|\| ""\)/);
});

test("Git ignora segredos, bancos e dependências", () => {
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /backend\/data\/\*\.db/);
  assert.match(gitignore, /node_modules\//);
});


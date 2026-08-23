"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.join(__dirname, "..");
const menu = JSON.parse(fs.readFileSync(path.join(raiz, "data", "menu.json"), "utf8"));

test("estrutura mínima do cardápio é válida", () => {
  assert.ok(menu.restaurante?.nome);
  assert.ok(Array.isArray(menu.categorias));
  assert.ok(Array.isArray(menu.produtos));
  assert.ok(menu.produtos.length > 0);
});

test("IDs de categorias e produtos não se repetem", () => {
  const validar = (lista) => assert.equal(new Set(lista.map((x) => x.id)).size, lista.length);
  validar(menu.categorias);
  validar(menu.produtos);
});

test("todo produto aponta para categoria existente e possui preço válido", () => {
  const categorias = new Set(menu.categorias.map((c) => c.id));
  for (const produto of menu.produtos) {
    assert.ok(categorias.has(produto.categoria), `${produto.id}: categoria inexistente`);
    assert.ok(produto.nome, `${produto.id}: nome vazio`);
    assert.ok(Number.isFinite(Number(produto.preco)) && Number(produto.preco) >= 0, `${produto.id}: preço inválido`);
  }
});

test("imagens locais referenciadas existem", () => {
  for (const produto of menu.produtos) {
    if (!produto.foto || /^https?:/i.test(produto.foto)) continue;
    assert.ok(fs.existsSync(path.join(raiz, produto.foto)), `${produto.id}: imagem ausente ${produto.foto}`);
  }
});

test("BRUTU'S PICKLES está correto", () => {
  const produto = menu.produtos.find((p) => p.id === "g009");
  assert.ok(produto);
  assert.equal(produto.nome, "BRUTU'S PICKLES");
  assert.equal(produto.preco, 38.9);
  assert.ok(produto.ingredientes.includes("Picles crocantes"));
});

test("espelhos JSON do cardápio permanecem iguais", () => {
  const espelho = JSON.parse(fs.readFileSync(path.join(raiz, "menu.json"), "utf8"));
  assert.deepEqual(espelho, menu);
});

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

test("endereço de retirada está atualizado", () => {
  assert.equal(menu.restaurante.enderecoRetirada, "Rua Seis de Janeiro, 806 - Em frente ao Pé na Areia");
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

test("combos X Brutus Clássico possuem composição e preços corretos", () => {
  const individual = menu.produtos.find((p) => p.id === "c008");
  const duplo = menu.produtos.find((p) => p.id === "c009");
  const familia = menu.produtos.find((p) => p.id === "c010");
  assert.equal(individual.preco, 37.99);
  assert.equal(duplo.preco, 69.99);
  assert.equal(duplo.qtdLanches, 2);
  assert.equal(familia.preco, 99.99);
  assert.equal(familia.qtdLanches, 3);
  assert.ok(familia.ingredientes.includes("3x X Brutus Clássico"));
});

test("espelhos JSON do cardápio permanecem iguais", () => {
  const espelho = JSON.parse(fs.readFileSync(path.join(raiz, "menu.json"), "utf8"));
  assert.deepEqual(espelho, menu);
});

test("fallback de dois cliques permanece igual ao cardápio oficial", () => {
  const arquivo = fs.readFileSync(path.join(raiz, "data", "menu-data.js"), "utf8");
  const prefixo = "// Gerado automaticamente a partir de data/menu.json\nwindow.MENU_DATA = ";
  assert.ok(arquivo.startsWith(prefixo));
  const embutido = JSON.parse(arquivo.slice(prefixo.length).replace(/;\s*$/, ""));
  assert.deepEqual(embutido, menu);
});

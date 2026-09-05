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

test("combos X Brutus Clássico com bacon possuem composição e preços corretos", () => {
  const individual = menu.produtos.find((p) => p.id === "c008");
  const duplo = menu.produtos.find((p) => p.id === "c009");
  const familia = menu.produtos.find((p) => p.id === "c010");
  assert.equal(individual.preco, 37.99);
  assert.equal(duplo.preco, 69.99);
  assert.equal(duplo.qtdLanches, 2);
  assert.equal(familia.preco, 99.99);
  assert.equal(familia.qtdLanches, 3);
  assert.ok(individual.ingredientes.includes("1x X Brutus Clássico com bacon"));
  assert.ok(duplo.ingredientes.includes("2x X Brutus Clássico com bacon"));
  assert.ok(familia.ingredientes.includes("3x X Brutus Clássico com bacon"));
  for (const combo of [individual, duplo, familia]) {
    assert.equal(combo.escolhaObrigatoria, true);
    assert.equal(combo.escolhaUnicaGlobal, true);
    assert.ok(combo.escolhaUnicaIds.length >= 1);
  }
});

test("pedido mínimo e bebidas obrigatórias dos combos estão configurados", () => {
  assert.equal(menu.restaurante.pedidoMinimoEntrega, 20);
  assert.ok(menu.adicionaisDisponiveis.some((a) => a.id === "acomp-refri-1l"));
  assert.ok(menu.adicionaisDisponiveis.some((a) => a.id === "acomp-refri-2l"));
});

test("lista de entrega contém as 45 localidades postais verificadas de Morro Agudo", () => {
  const nomes = menu.taxasEntrega.map((taxa) => taxa.nome);
  assert.equal(nomes.length, 45);
  assert.equal(new Set(nomes).size, 45);
  assert.ok(nomes.includes("Alto da Boa Vista"));
  assert.ok(nomes.includes("Área Rural de Morro Agudo"));
  assert.ok(nomes.includes("Distrito Empresarial Shigeyuki Yamaguchi (Paulo Yamaguchi)"));
  assert.ok(nomes.includes("Santo Inácio dos Vieiras"));
  assert.ok(nomes.includes("Vila Martins"));
  assert.ok(!nomes.includes("Sem Terra"));
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

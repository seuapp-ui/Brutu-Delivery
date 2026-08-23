"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "brutus-test-"));
process.env.DATABASE_PATH = path.join(pasta, "teste.db");
const banco = require("../backend/db");

test.after(() => {
  banco.fechar();
  fs.rmSync(pasta, { recursive: true, force: true });
});

test("banco inicia e importa o cardápio", () => {
  banco.abrir();
  const info = banco.infoDb();
  assert.equal(info.tipo, "sqlite");
  assert.ok(banco.lerMenu().produtos.some((p) => p.id === "g009"));
});

test("pedido pode ser inserido, consultado e atualizado", () => {
  const pedido = { id: "p-teste-001", numero: "T001", ts: Date.now(), status: "recebido", total: 38.9, itens: [] };
  banco.inserirPedido(pedido);
  assert.equal(banco.obterPedido(pedido.id).total, 38.9);
  pedido.status = "preparando";
  banco.atualizarPedido(pedido);
  assert.equal(banco.obterPedido(pedido.id).status, "preparando");
});

test("sessão pode ser criada, validada e revogada", () => {
  const sessao = banco.criarSessao("admin");
  assert.equal(banco.validarSessao(sessao.token).usuario, "admin");
  banco.revogarSessao(sessao.token);
  assert.equal(banco.validarSessao(sessao.token), null);
});

test("cardápio salvo permanece disponível", () => {
  const menu = banco.lerMenu();
  menu.restaurante.tempoEstimado = "teste";
  banco.salvarMenu(menu);
  assert.equal(banco.lerMenu().restaurante.tempoEstimado, "teste");
});

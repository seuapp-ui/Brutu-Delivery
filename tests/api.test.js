"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

let dependenciasDisponiveis = true;
try { require.resolve("express"); require.resolve("cors"); } catch { dependenciasDisponiveis = false; }

test("fluxo HTTP: login, proteção e pedido recalculado", { skip: !dependenciasDisponiveis }, async (t) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "brutus-api-"));
  process.env.DATABASE_PATH = path.join(pasta, "api.db");
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASSWORD = "Senha-Teste-123";
  process.env.ALLOW_LOCAL_ORIGINS = "true";
  process.env.TZ = "America/Sao_Paulo";

  const banco = require("../backend/db");
  const { iniciar } = require("../backend/server");
  const servidor = iniciar(0);
  if (!servidor.listening) await once(servidor, "listening");
  const base = `http://127.0.0.1:${servidor.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => servidor.close(resolve));
    banco.fechar();
    fs.rmSync(pasta, { recursive: true, force: true });
  });

  let resposta = await fetch(base + "/api/pedidos");
  assert.equal(resposta.status, 401);

  resposta = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario: "admin", senha: "Senha-Teste-123" }),
  });
  assert.equal(resposta.status, 200);
  const token = (await resposta.json()).token;
  assert.ok(token);

  const menu = banco.lerMenu();
  delete menu.restaurante.horario;
  menu.restaurante.pedidoMinimoEntrega = 0;
  banco.salvarMenu(menu);
  const produto = menu.produtos.find((p) => p.id === "g009");

  resposta = await fetch(base + "/api/pedidos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "p-api-teste-001", numero: "API001", cliente: "Cliente Teste",
      telefone: "(16) 99999-0000", tipoEntrega: "retirada", formaPagamento: "PIX",
      total: 0.01, taxa: -500, desconto: 9999,
      itens: [{ produtoId: produto.id, quantidade: 1, preco: 0.01 }],
    }),
  });
  assert.equal(resposta.status, 201);
  const pedido = await resposta.json();
  assert.equal(pedido.total, produto.preco);
  assert.equal(pedido.itens[0].preco, produto.preco);

  resposta = await fetch(base + "/api/pedidos", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(resposta.status, 200);
  assert.ok((await resposta.json()).some((p) => p.id === pedido.id));

  resposta = await fetch(base + `/api/pedidos/${pedido.id}/status`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "entregue" }),
  });
  assert.equal(resposta.status, 409);
});

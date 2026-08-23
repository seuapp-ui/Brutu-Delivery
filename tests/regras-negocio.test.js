"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const regras = require("../backend/lib/regras-negocio");

test("moeda arredonda sem imprecisão aparente", () => {
  assert.equal(regras.moeda(10.005), 10.01);
  assert.equal(regras.moeda("38.90"), 38.9);
  assert.equal(regras.moeda("inválido"), 0);
});

test("telefone mantém somente dígitos e limita o tamanho", () => {
  assert.equal(regras.normalizarTelefone("(16) 99999-0000"), "16999990000");
  assert.equal(regras.normalizarTelefone("123456789012345678"), "123456789012345");
});

test("texto é aparado e limitado", () => {
  assert.equal(regras.limitarTexto("  cliente  ", 20), "cliente");
  assert.equal(regras.limitarTexto("abcdef", 3), "abc");
});

test("horário normal abre e fecha corretamente", () => {
  const menu = { restaurante: { horario: { abre: "18:00", fecha: "23:30", diasFechado: [] } } };
  assert.equal(regras.lojaAbertaEm(menu, new Date(2026, 7, 23, 19, 0)), true);
  assert.equal(regras.lojaAbertaEm(menu, new Date(2026, 7, 23, 12, 0)), false);
  assert.equal(regras.lojaAbertaEm(menu, new Date(2026, 7, 23, 23, 30)), false);
});

test("horário que atravessa meia-noite funciona", () => {
  const menu = { restaurante: { horario: { abre: "18:00", fecha: "02:00", diasFechado: [] } } };
  assert.equal(regras.lojaAbertaEm(menu, new Date(2026, 7, 23, 1, 0)), true);
  assert.equal(regras.lojaAbertaEm(menu, new Date(2026, 7, 23, 3, 0)), false);
});

test("dia fechado tem prioridade", () => {
  const data = new Date(2026, 7, 23, 19, 0);
  const menu = { restaurante: { horario: { abre: "18:00", fecha: "23:30", diasFechado: [data.getDay()] } } };
  assert.equal(regras.lojaAbertaEm(menu, data), false);
});

test("cupom percentual e fixo nunca passam do subtotal", () => {
  assert.equal(regras.calcularDescontoCupom(100, { ativo: true, tipo: "percentual", valor: 10 }), 10);
  assert.equal(regras.calcularDescontoCupom(20, { ativo: true, tipo: "fixo", valor: 50 }), 20);
  assert.equal(regras.calcularDescontoCupom(100, { ativo: false, tipo: "fixo", valor: 50 }), 0);
});

test("somente transições permitidas de pedido são aceitas", () => {
  assert.equal(regras.transicaoStatusValida("recebido", "preparando"), true);
  assert.equal(regras.transicaoStatusValida("recebido", "entregue"), false);
  assert.equal(regras.transicaoStatusValida("entregue", "recebido"), true);
});

"use strict";

function moeda(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.round((numero + Number.EPSILON) * 100) / 100;
}

function normalizarTelefone(valor) {
  return String(valor || "").replace(/\D/g, "").slice(0, 15);
}

function limitarTexto(valor, maximo) {
  return String(valor || "").trim().slice(0, Math.max(0, Number(maximo) || 0));
}

function minutosDoHorario(valor) {
  if (!/^\d{1,2}:\d{2}$/.test(String(valor || ""))) return null;
  const [hora, minuto] = String(valor).split(":").map(Number);
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) return null;
  return hora * 60 + minuto;
}

function lojaAbertaEm(menu, agora = new Date()) {
  const horario = menu?.restaurante?.horario;
  if (!horario?.abre || !horario?.fecha) return true;
  if ((horario.diasFechado || []).map(Number).includes(agora.getDay())) return false;
  const abre = minutosDoHorario(horario.abre);
  const fecha = minutosDoHorario(horario.fecha);
  if (abre == null || fecha == null) return true;
  const atual = agora.getHours() * 60 + agora.getMinutes();
  return fecha > abre ? atual >= abre && atual < fecha : atual >= abre || atual < fecha;
}

function calcularDescontoCupom(subtotal, cupom) {
  const base = Math.max(0, moeda(subtotal));
  if (!cupom || cupom.ativo === false) return 0;
  const bruto = cupom.tipo === "percentual"
    ? base * Math.max(0, Number(cupom.valor) || 0) / 100
    : Math.max(0, Number(cupom.valor) || 0);
  return moeda(Math.min(base, bruto));
}

const TRANSICOES_STATUS = Object.freeze({
  recebido: ["preparando", "cancelado"],
  preparando: ["pronto", "cancelado"],
  pronto: ["saiu_entrega", "entregue", "cancelado"],
  saiu_entrega: ["entregue", "cancelado"],
  entregue: ["recebido"],
  cancelado: ["recebido"],
});

function transicaoStatusValida(anterior, proximo) {
  return (TRANSICOES_STATUS[anterior] || []).includes(proximo);
}

module.exports = {
  moeda,
  normalizarTelefone,
  limitarTexto,
  minutosDoHorario,
  lojaAbertaEm,
  calcularDescontoCupom,
  TRANSICOES_STATUS,
  transicaoStatusValida,
};

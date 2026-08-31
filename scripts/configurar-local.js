"use strict";
const crypto = require("node:crypto");
const store = require("../backend/db");

const senha = String(process.env.BRUTUS_SETUP_PASSWORD || "");
const usuario = String(process.env.BRUTUS_SETUP_USER || "admin").trim() || "admin";
if (senha.length < 8) {
  console.error("A senha precisa ter pelo menos 8 caracteres.");
  process.exitCode = 1;
} else {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(senha, salt, 64).toString("hex");
  store.salvarAuth({ usuario, senha: `scrypt$${salt}$${hash}`, tokenSecreto: crypto.randomBytes(32).toString("hex") });
  store.revogarTodasSessoes();
  store.fechar();
  console.log("Acesso local configurado com segurança.");
}

/* =========================================================================
   site-config.js — CONFIGURAÇÃO CENTRAL DO SITE
   -------------------------------------------------------------------------
   Este arquivo é lido por index.html, painel.html e painel-produtos.html.
   ========================================================================= */

window.SITE_CONFIG = {

  // Senha legada (painel.html / fallback offline). Com a API rodando,
  // o login do painel-produtos usa usuario+senha em backend/data/auth.json.
  senhaPainel: "5625",

  // URL da API. Vazio = mesma origem (quando o site é servido pelo backend).
  // Ex. em dev separado: "http://localhost:3000"
  apiBase: "",

  tema: {
    accent: "#ff5a1f",
    accentDark: "#d6480f",
    ember: "#ffb100"
  }

};

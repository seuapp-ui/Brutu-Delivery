/* =========================================================================
   site-config.js — CONFIGURAÇÃO CENTRAL DO SITE
   -------------------------------------------------------------------------
   Este arquivo é lido por index.html, painel.html e painel de controle.html.
   ========================================================================= */

window.SITE_CONFIG = {

  // Versão do app — só usada em logs e no aviso de "nova versão disponível"
  // (ver js/app.js, seção PWA). Suba esse número junto com CACHE_VERSION em
  // sw.js sempre que publicar uma atualização de verdade.
  appVersion: "1.1.0",

  // Senha legada (painel.html / fallback offline). Com a API rodando,
  // o login do painel de controle usa usuario+senha em backend/data/auth.json.
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

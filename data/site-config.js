/* =========================================================================
   site-config.js — CONFIGURAÇÃO CENTRAL DO SITE
   -------------------------------------------------------------------------
   Este arquivo é lido por index.html e painel.html.
   NÃO coloque senhas ou chaves PIX aqui (use variáveis de ambiente no Render).
   ========================================================================= */

window.SITE_CONFIG = {

  // Versão do app — só usada em logs e no aviso de "nova versão disponível"
  // (ver js/app.js, seção PWA). Suba esse número junto com CACHE_VERSION em
  // sw.js sempre que publicar uma atualização de verdade.
  appVersion: "1.4.0",

  // Edição independente: pedidos enviados diretamente pelo WhatsApp.
  apiBase: "",

  tema: {
    accent: "#ff5a1f",
    accentDark: "#d6480f",
    ember: "#ffb100"
  }

};

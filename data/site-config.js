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
  appVersion: "1.6.0",

  // API do mesmo servidor (mantida para compatibilidade com instalações locais).
  apiBase: "",

  // Servidor online que recebe pedidos mesmo quando o PC da loja está desligado.
  // É apenas uma URL pública; credenciais administrativas nunca ficam neste arquivo.
  onlineApiBase: "https://brutu-s-delivery.onrender.com",

  tema: {
    accent: "#ff5a1f",
    accentDark: "#d6480f",
    ember: "#ffb100"
  }

};

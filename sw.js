/* =========================================================================
   BRUTU'S DELIVERY — sw.js (Service Worker)
   -------------------------------------------------------------------------
   Estratégia:
   - App shell (html/css/js/ícones): "cache first" — carrega instantâneo
     e funciona sem internet depois do primeiro acesso.
   - menu.json: "network first, cache fallback" — assim, sempre que o
     cliente tiver internet, ele vê o cardápio mais atualizado; se estiver
     offline, cai para a última versão salva.

   Ao alterar o menu.json, o CACHE_VERSION não precisa mudar: o cardápio
   é buscado direto da rede sempre que possível. Se quiser forçar a
   atualização de arquivos de layout (css/js) para quem já instalou o app,
   troque o número da versão abaixo.
   ========================================================================= */

const CACHE_VERSION = "brutus-v9-whatsapp";
const STATIC_CACHE = `${CACHE_VERSION}-estatico`;
const DATA_CACHE = `${CACHE_VERSION}-dados`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./css/roleta.css",
  "./js/roleta.js",
  "./data/menu-data.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/og-image.jpg",
];

const MENU_URL_PATH = "/data/menu.json";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(
        chaves
          .filter((chave) => chave.startsWith("brutus-") && chave !== STATIC_CACHE && chave !== DATA_CACHE)
          .map((chave) => caches.delete(chave))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Nunca cachear API nem painel administrativo.
  // Isso evita painel/login antigo preso no Service Worker após um deploy.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.endsWith("/painel.html") ||
    url.pathname.endsWith("/painel-de-controle.html")
  ) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() => {
        return new Response("Offline", { status: 503, statusText: "Offline" });
      })
    );
    return;
  }

  // Estratégia especial para o cardápio (menu.json): network-first
  if (url.pathname.endsWith(MENU_URL_PATH) || url.pathname.endsWith("menu.json")) {
    event.respondWith(
      fetch(request)
        .then((respostaRede) => {
          const clone = respostaRede.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(request, clone));
          return respostaRede;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell e demais arquivos: cache-first, com atualização em segundo plano
  event.respondWith(
    caches.match(request).then((respostaCache) => {
      const fetchPromise = fetch(request)
        .then((respostaRede) => {
          if (respostaRede && respostaRede.status === 200) {
            const clone = respostaRede.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return respostaRede;
        })
        .catch(() => respostaCache);
      return respostaCache || fetchPromise;
    })
  );
});

/* =========================================================================
   BRUTU'S DELIVERY — app.js
   -------------------------------------------------------------------------
   Cardápio público com envio independente para a API online e WhatsApp.
   Se a API estiver indisponível, o WhatsApp continua funcionando.

   Estrutura deste arquivo (procure pelos comentários "SEÇÃO"):
     1. CONFIG / CONSTANTES
     2. ESTADO GLOBAL
     3. UTILITÁRIOS (formatação, storage)
     4. CARREGAMENTO DO CARDÁPIO (fetch + fallback offline)
     5. RENDERIZAÇÃO — Home (categorias, produtos, busca)
     6. MODAL DE PRODUTO (detalhe, adicionais, quantidade)
     7. CARRINHO (estado, render, edição)
     8. CHECKOUT (formulário, validação, forma de pagamento)
     9. MONTAGEM DA MENSAGEM E ENVIO PARA O WHATSAPP
    10. PWA (service worker)
    11. INICIALIZAÇÃO
   ========================================================================= */

(() => {
  "use strict";

  /* =====================================================================
     1. CONFIG / CONSTANTES
     ===================================================================== */
  const MENU_JSON_URL = "data/menu.json";
  const CART_STORAGE_KEY = "brutus-delivery:cart:v1";

  // Chave usada apenas para persistir os dados já preenchidos do cliente
  // (nome, telefone, endereço) para não precisar digitar de novo na próxima
  // visita. Nada disso é enviado para nenhum servidor — fica só no aparelho.
  const CUSTOMER_STORAGE_KEY = "brutus-delivery:cliente:v1";

  // Resumo compacto do último pedido concluído (nome, itens, total, data) —
  // usado só para conveniência do cliente (ex: "pedir de novo"). Não é o
  // histórico completo de pedidos (isso já existe em "brutus-pedidos:v1").
  const LAST_ORDER_STORAGE_KEY = "brutus-delivery:ultimo-pedido:v1";
  const PENDING_ORDERS_STORAGE_KEY = "brutus-delivery:pedidos-pendentes:v1";

  // Versão do app — usada só em logs (ver seção 10, PWA) para identificar
  // qual build está rodando. Para forçar arquivos estáticos (css/js) a
  // atualizar em quem já instalou o app, troque também CACHE_VERSION em
  // sw.js — os dois números são independentes.
  const APP_VERSION = (window.SITE_CONFIG && window.SITE_CONFIG.appVersion) || "1.1.0";

  // Intervalo de verificação automática de novidades no cardápio (produtos,
  // preços, categorias, banners, avisos). Só troca os dados quando algo
  // realmente mudou — ver seção 4B mais abaixo.
  const MENU_POLL_INTERVAL_MS = 60 * 1000;

  /* =====================================================================
     2. ESTADO GLOBAL
     ===================================================================== */
  const state = {
    menu: null,               // conteúdo carregado de menu.json
    categoriaAtiva: null,     // id da categoria em foco no scroll
    termoBusca: "",
    cart: [],                 // itens da sacola (ver shape em addToCart)
    tipoEntrega: "entrega",   // "entrega" | "retirada"
    formaPagamento: "PIX",    // "PIX" | "Dinheiro" | "Cartão"
    cupomAplicado: null,      // { codigo, tipo, valor, descontoCalculado }
    premioRoleta: null,       // prêmio selecionado no checkout { id, tipo, ... }
    produtoEmEdicao: null,    // produto aberto no modal
    adicionaisSelecionados: [],   // array de Set — um Set por lanche (combos com vários lanches têm 1 Set por lanche)
    quantidadeModal: 1,
    _statusInterval: null,     // setInterval do relógio "Aberto/Fechado" (já existia)
    _menuPollInterval: null,   // setInterval da verificação automática do cardápio
    _menuPollEmAndamento: false, // evita duas verificações simultâneas
    _sectionsObserver: null,   // IntersectionObserver da nav de categorias
  };

  /* =====================================================================
     3. UTILITÁRIOS
     ===================================================================== */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  // Embaralha um array (Fisher-Yates) sem alterar o original — usado para a
  // ordem dos Destaques mudar sozinha a cada visita/recarregamento.
  function embaralhar(lista) {
    const arr = [...lista];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatarPreco(valor) {
    return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function escaparHtml(valor) {
    return String(valor == null ? "" : valor).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  // Arredonda para centavos (2 casas decimais) evitando erros clássicos de
  // ponto flutuante do JavaScript (ex: 77.7 - 6 pode virar 71.69999999999999).
  // Usado em qualquer comparação/soma de dinheiro que não passe direto pelo
  // formatarPreco (que já arredonda visualmente, mas não corrige o valor em si).
  function arredondarMoeda(valor) {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
  }

  function parseValorBR(str) {
    if (!str) return NaN;
    const limpo = str
      .replace(/\s/g, "")
      .replace(/[^\d,.-]/g, "")
      .replace(/\.(?=\d{3}(,|$))/g, "") // remove pontos de milhar
      .replace(",", ".");
    return parseFloat(limpo);
  }

  function salvarCart() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
    } catch (e) {
      console.warn("Não foi possível salvar a sacola localmente:", e);
    }
  }

  function carregarCartSalvo() {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function salvarDadosCliente(dados) {
    try {
      localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify({ ...dados, _salvoEm: Date.now() }));
    } catch (e) { /* silencioso — recurso de conveniência, não crítico */ }
  }

  function carregarDadosCliente() {
    try {
      const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY);
      if (!raw) return null;
      const dados = JSON.parse(raw);
      const validade = 90 * 24 * 60 * 60 * 1000;
      if (dados._salvoEm && Date.now() - dados._salvoEm > validade) {
        localStorage.removeItem(CUSTOMER_STORAGE_KEY);
        return null;
      }
      return dados;
    } catch (e) {
      return null;
    }
  }

  // Guarda só um resumo compacto do pedido mais recente (não é o histórico
  // completo — isso já existe em "brutus-pedidos:v1"). Sempre sobrescreve o
  // anterior, então nunca cresce sem limite.
  function salvarUltimoPedido(resumo) {
    try {
      localStorage.setItem(LAST_ORDER_STORAGE_KEY, JSON.stringify(resumo));
    } catch (e) { /* silencioso — recurso de conveniência, não crítico */ }
  }

  function carregarUltimoPedido() {
    try {
      const raw = localStorage.getItem(LAST_ORDER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function mostrarToast(mensagem, duracaoMs = 1800, variante = "") {
    const toast = document.createElement("div");
    toast.className = variante ? `toast toast--${variante}` : "toast";
    toast.textContent = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duracaoMs);
  }

  // Gera um identificador único para cada item da sacola. Usar só Date.now()
  // podia colidir se dois itens fossem adicionados no mesmo milissegundo
  // (ex: toques rápidos no botão "+"), fazendo remover/alterar quantidade
  // afetar o item errado. O sufixo aleatório elimina esse risco.
  function gerarUidItem(produtoId) {
    return `${produtoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  }

  function travarScroll(travar) {
    document.body.style.overflow = travar ? "hidden" : "";
  }

  // Mede a altura real do cabeçalho e ajusta a variável CSS --header-height,
  // usada pelo menu de categorias (sticky) para não ficar escondido atrás
  // do cabeçalho ao rolar a página. Precisa ser refeito depois que a fonte
  // customizada carrega, porque isso pode mudar a altura do texto.
  function ajustarOffsetHeader() {
    const header = $(".app-header");
    if (!header) return;
    const altura = Math.ceil(header.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--header-height", `${altura}px`);
  }

  /* =====================================================================
     4. CARREGAMENTO DO CARDÁPIO
     ===================================================================== */
  async function carregarMenu() {
    // MODO TESTE (abrindo o index.html com duplo clique, protocolo file://):
    // navegadores bloqueiam fetch() de arquivos locais por segurança, então
    // usamos os dados já carregados pelo <script src="data/menu-data.js">
    // (variável global window.MENU_DATA). É o mesmo conteúdo do menu.json,
    // só que embrulhado em JS para poder ser lido sem servidor.
    if (location.protocol === "file:") {
      if (window.MENU_DATA) return window.MENU_DATA;
      throw new Error("menu-data.js não encontrado");
    }

    // Preferência: API do backend (injeta PIX das variáveis de ambiente)
    try {
      const apiBase = (window.SITE_CONFIG && window.SITE_CONFIG.apiBase)
        ? String(window.SITE_CONFIG.apiBase).replace(/\/$/, "")
        : "";
      const urlApi = (apiBase || "") + "/api/menu";
      const respApi = await fetch(urlApi, { cache: "no-store" });
      if (respApi.ok) return await respApi.json();
    } catch (e) {
      /* cai para menu.json estático */
    }

    // MODO HOSPEDADO: menu.json estático / cache / embutido
    try {
      const resp = await fetch(MENU_JSON_URL, { cache: "no-store" });
      if (!resp.ok) throw new Error("Falha ao buscar menu.json");
      return await resp.json();
    } catch (erroRede) {
      const respCache = await caches?.match?.(MENU_JSON_URL).catch(() => null);
      if (respCache) {
        mostrarOfflineBanner(true);
        return respCache.json();
      }
      if (window.MENU_DATA) return window.MENU_DATA;
      throw erroRede;
    }
  }

  function mostrarOfflineBanner(offline) {
    const banner = $("#offline-indicator");
    if (banner) banner.classList.toggle("hidden", !offline);
  }

  /* =====================================================================
     4B. ATUALIZAÇÃO AUTOMÁTICA DO CARDÁPIO (a cada 60s, sem recarregar)
     -------------------------------------------------------------------
     A cada minuto, busca data/menu.json de novo e compara com o que já
     está na tela. Se não mudou nada, não faz absolutamente nada (sem
     re-render, sem piscada). Se mudou (produto, preço, categoria, banner,
     disponibilidade, horário etc.), atualiza só as seções de exibição do
     cardápio — nunca a sacola, o formulário de checkout ou modais abertos.
     ===================================================================== */
  function iniciarAtualizacaoAutomatica() {
    if (location.protocol === "file:") return; // modo teste local, sem fetch
    if (state._menuPollInterval) return; // já está rodando — não duplica

    state._menuPollInterval = setInterval(verificarAtualizacaoMenu, MENU_POLL_INTERVAL_MS);

    // Quando o cliente volta pra aba depois de um tempo fora, verifica na
    // hora em vez de esperar o próximo tique do intervalo de 60s.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") verificarAtualizacaoMenu();
    });
  }

  async function verificarAtualizacaoMenu() {
    // Aba em segundo plano: não gasta dados/bateria verificando à toa.
    if (document.visibilityState === "hidden") return;
    // Evita duas verificações simultâneas (ex: o intervalo e o
    // visibilitychange disparando quase ao mesmo tempo).
    if (state._menuPollEmAndamento) return;
    state._menuPollEmAndamento = true;

    try {
      const resp = await fetch(MENU_JSON_URL, { cache: "no-store" });
      if (!resp.ok) throw new Error("Falha ao buscar menu.json");
      const novoMenu = await resp.json();

      const mudou = JSON.stringify(novoMenu) !== JSON.stringify(state.menu);
      if (!mudou) return;

      aplicarAtualizacaoMenu(novoMenu);
    } catch (erro) {
      // Falha de rede/parse: mantém os dados atuais e tenta de novo no
      // próximo ciclo — nunca quebra a tela nem limpa nada do cliente.
      console.warn("[UPDATE] Não foi possível verificar atualizações agora:", erro);
    } finally {
      state._menuPollEmAndamento = false;
    }
  }

  // Aplica um cardápio novo SEM tocar na sacola, no formulário de checkout
  // ou em modais abertos — só re-renderiza cabeçalho, navegação de
  // categorias, destaques e a lista de produtos (as mesmas funções usadas
  // no carregamento inicial, então o resultado visual é idêntico ao de um
  // carregamento normal, só que sem reload de página).
  function aplicarAtualizacaoMenu(novoMenu) {
    state.menu = novoMenu;

    renderCabecalho();
    renderCategoriaNav();
    renderDestaques();
    renderProdutos();
    observarSecoes();

    // Se a categoria que o cliente estava vendo deixou de existir (ex: foi
    // removida no painel), volta a referência pra primeira categoria
    // disponível só internamente — não mexe no scroll do cliente.
    if (novoMenu.categorias?.length && !novoMenu.categorias.some((c) => c.id === state.categoriaAtiva)) {
      state.categoriaAtiva = novoMenu.categorias[0].id;
    }
  }

  /* =====================================================================
     5. RENDERIZAÇÃO — HOME
     ===================================================================== */
  // Calcula se a loja está aberta agora e monta o texto a ser exibido no
  // cabeçalho (ex: "Aberto agora · fecha às 03:00", "Fechado agora · abre
  // às 18:00", "Fechado hoje"). Centraliza a lógica usada tanto pelo status
  // visual quanto pelas checagens de "pode enviar pedido".
  function obterInfoHorario(horario) {
    if (!horario) return { aberto: true, texto: "" };

    const agora = new Date();
    const diaSemana = agora.getDay(); // 0=domingo ... 6=sábado
    const diaAnterior = (diaSemana + 6) % 7;
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    const diasFechado = horario.diasFechado || [];

    // Retorna {abre, fecha} do dia informado, usando a exceção específica
    // desse dia da semana (horario.excecoes[dia]) quando existir, ou o
    // horário padrão (horario.abre / horario.fecha) como fallback.
    function horarioDoDia(dia) {
      const excecao = horario.excecoes && horario.excecoes[dia];
      return {
        abre: (excecao && excecao.abre) || horario.abre || "00:00",
        fecha: (excecao && excecao.fecha) || horario.fecha || "23:59",
      };
    }

    // 1) Turno de ONTEM: se ontem não estava fechado e o horário de ontem
    //    atravessa a meia-noite (fecha < abre), o turno pode continuar
    //    aberto até agora (ex: sexta 18:00 até sábado 03:00).
    if (!diasFechado.includes(diaAnterior)) {
      const hOntem = horarioDoDia(diaAnterior);
      const [haO, maO] = hOntem.abre.split(":").map(Number);
      const [hfO, mfO] = hOntem.fecha.split(":").map(Number);
      const minAbreOntem = haO * 60 + maO;
      const minFechaOntem = hfO * 60 + mfO;
      if (minFechaOntem < minAbreOntem && minutosAgora <= minFechaOntem) {
        return { aberto: true, texto: `Aberto agora · fecha às ${hOntem.fecha}` };
      }
    }

    // 2) Turno de HOJE
    if (diasFechado.includes(diaSemana)) {
      return { aberto: false, texto: "Fechado hoje" };
    }
    const hHoje = horarioDoDia(diaSemana);
    const [horaAbre, minAbre] = hHoje.abre.split(":").map(Number);
    const [horaFecha, minFecha] = hHoje.fecha.split(":").map(Number);
    const minutosAbre = horaAbre * 60 + minAbre;
    const minutosFecha = horaFecha * 60 + minFecha;

    let aberto;
    if (minutosFecha > minutosAbre) {
      // horário no mesmo dia, ex: 18:00 até 23:30
      aberto = minutosAgora >= minutosAbre && minutosAgora <= minutosFecha;
    } else {
      // horário que atravessa a meia-noite, ex: 18:00 até 03:00
      aberto = minutosAgora >= minutosAbre || minutosAgora <= minutosFecha;
    }

    const texto = aberto
      ? `Aberto agora · fecha às ${hHoje.fecha}`
      : `Fechado agora · abre às ${hHoje.abre}`;
    return { aberto, texto };
  }

  function calcularStatusAberto(horario) {
    return obterInfoHorario(horario).aberto;
  }

  function renderStatusAberto() {
    const r = state.menu?.restaurante;
    if (!r) return;
    const { aberto, texto } = obterInfoHorario(r.horario);
    const el = $("#restaurante-status");
    if (!el) return;
    el.textContent = texto || (aberto ? "Aberto agora" : "Fechado no momento");
    el.classList.toggle("status-aberto", aberto);
    el.classList.toggle("status-fechado", !aberto);
  }

  function renderCabecalho() {
    const r = state.menu.restaurante;
    $("#restaurante-nome").textContent = r.nome;
    $("#restaurante-logo").src = r.logo;
    $("#restaurante-logo").alt = `Logo do ${r.nome}`;
    $("#restaurante-tempo").textContent = r.tempoEstimado || "";
    document.title = `${r.nome} — Cardápio`;

    $("#hero-title").textContent = r.nome;
    $("#hero-slogan").textContent = r.slogan || "";
    $("#hero-slogan").classList.toggle("hidden", !r.slogan);
    $("#hero-mascot").src = r.logo;
    $("#hero-mascot").alt = `Mascote ${r.nome}`;
    $("#banner-tag").textContent = r.bannerTexto || "";
    $("#banner-tag").classList.toggle("hidden", !r.bannerTexto);

    // Modo banner promocional: se "bannerImagem" estiver preenchido no
    // menu.json, mostra a imagem ocupando todo o banner (ex: sorteio,
    // datas comemorativas). Se estiver vazio/ausente, volta pro banner
    // normal com mascote + texto.
    const promoImg = $("#hero-banner-promo");
    const temBannerImagem = !!(r.bannerImagem && r.bannerImagem.trim() !== "");
    $("#banner-wrap").classList.toggle("modo-imagem", temBannerImagem);
    promoImg.classList.toggle("hidden", !temBannerImagem);
    if (temBannerImagem) {
      promoImg.src = r.bannerImagem;
      promoImg.alt = r.bannerImagemAlt || `Promoção ${r.nome}`;
    }

    renderStatusAberto();
    if (!state._statusInterval) {
      state._statusInterval = setInterval(renderStatusAberto, 60 * 1000);
    }
  }

  function renderCategoriaNav() {
    const nav = $("#categoria-nav-scroll");
    nav.innerHTML = "";
    state.menu.categorias.forEach((cat) => {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.type = "button";
      chip.dataset.categoria = cat.id;
      chip.setAttribute("aria-current", cat.id === state.categoriaAtiva ? "true" : "false");
      chip.innerHTML = `<span class="chip-icon">${escaparHtml(cat.icone)}</span><span>${escaparHtml(cat.nome)}</span>`;
      chip.addEventListener("click", () => {
        const alvo = document.getElementById(`categoria-${cat.id}`);
        if (alvo) alvo.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      nav.appendChild(chip);
    });
  }

  // Carrossel "⭐ Destaques": junta os produtos marcados como destaque de
  // todas as categorias e mostra numa faixa horizontal (arrastável). A ordem
  // é sorteada a cada carregamento da página — não precisa reordenar na mão.
  function renderDestaques() {
    const secao = $("#destaques-section");
    const scroll = $("#destaques-scroll");
    const destaques = embaralhar(state.menu.produtos.filter((p) => p.destaque && produtoVisivelNoCardapio(p)));

    if (!destaques.length) {
      secao.classList.add("hidden");
      return;
    }

    scroll.innerHTML = "";
    destaques.forEach((produto) => {
      const card = document.createElement("div");
      card.className = "destaque-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `${produto.nome}, ${formatarPreco(produto.preco)}`);
      card.innerHTML = `
        <div class="destaque-photo">
          <img src="${escaparHtml(produto.foto)}" alt="${escaparHtml(produto.nome)}" loading="lazy">
        </div>
        <div class="destaque-nome">${escaparHtml(produto.nome)}</div>
        <div class="destaque-preco">${formatarPreco(produto.preco)}</div>
      `;
      const abrir = () => abrirModalProduto(produto);
      card.addEventListener("click", abrir);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
      });
      scroll.appendChild(card);
    });

    secao.classList.remove("hidden");
  }

  function produtoVisivelNoCardapio(p) {
    if (p.disponivel === false) return false;
    if (p.estoque !== undefined && p.estoque !== null && p.estoque !== "" && Number(p.estoque) <= 0) return false;
    return true;
  }

  function produtosFiltrados() {
    const termo = state.termoBusca.trim().toLowerCase();
    const base = (state.menu.produtos || []).filter(produtoVisivelNoCardapio);
    if (!termo) return base;
    return base.filter((p) =>
      (p.nome || "").toLowerCase().includes(termo) || (p.descricao || "").toLowerCase().includes(termo)
    );
  }

  function renderProdutos() {
    const container = $("#categorias-container");
    container.innerHTML = "";
    const produtos = produtosFiltrados();
    const semResultado = $("#sem-resultado");

    if (produtos.length === 0) {
      semResultado.classList.remove("hidden");
      return;
    }
    semResultado.classList.add("hidden");

    state.menu.categorias.forEach((cat) => {
      // A categoria "Lançamentos" não depende só do campo `categoria`: qualquer
      // produto marcado com `lancamento: true` aparece aqui automaticamente,
      // mesmo mantendo sua categoria "de verdade" (ex: um hambúrguer gourmet
      // continua em Hambúrgueres Gourmet e também aparece em Lançamentos).
      const produtosDaCategoria =
        cat.id === "lancamentos"
          ? produtos.filter((p) => p.categoria === cat.id || p.lancamento)
          : produtos.filter((p) => p.categoria === cat.id);
      if (produtosDaCategoria.length === 0) return;

      const secao = document.createElement("section");
      secao.id = `categoria-${String(cat.id).replace(/[^a-z0-9_-]/gi, "-")}`;
      secao.innerHTML = `
        <h2 class="section-title"><span class="selo" aria-hidden="true">${escaparHtml(cat.icone)}</span>${escaparHtml(cat.nome)}</h2>
        <div class="product-grid"></div>
      `;
      const grid = $(".product-grid", secao);
      produtosDaCategoria.forEach((produto) => grid.appendChild(criarCardProduto(produto)));
      container.appendChild(secao);
    });
  }

  function criarCardProduto(produto) {
    // Produtos sem adicionais (ex: bebidas, algumas porções) ganham um atalho:
    // tocar no "+" adiciona 1 unidade direto na sacola, sem abrir o modal.
    // Tocar no resto do card continua abrindo o modal completo (útil se o
    // cliente quiser deixar uma observação, mesmo sem adicionais).
    const semAdicionais = !(produto.adicionais && produto.adicionais.length);

    // Usamos <div role="button"> em vez de <button> porque o botão de
    // adição rápida também precisa ser um <button> — e a especificação de
    // HTML não permite <button> dentro de <button>.
    const card = document.createElement("div");
    card.className = "product-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `${produto.nome}, ${formatarPreco(produto.preco)}`);
    card.innerHTML = `
      <div class="product-photo">
        ${produto.destaque ? `<span class="badge-destaque selo">TOP</span>` : ""}
        ${produto.lancamento ? `<span class="badge-lancamento">🆕 Novo</span>` : ""}
        <img src="${escaparHtml(produto.foto)}" alt="${escaparHtml(produto.nome)}" loading="lazy">
      </div>
      <div class="product-info">
        <div class="product-name">${escaparHtml(produto.nome)}</div>
        <div class="product-desc">${escaparHtml(produto.descricao)}</div>
        <div class="product-bottom">
          <span class="product-price">${formatarPreco(produto.preco)}</span>
          ${semAdicionais
            ? `<button type="button" class="btn-add-mini" data-quick-add aria-label="Adicionar 1x ${escaparHtml(produto.nome)} direto na sacola">+</button>`
            : `<span class="btn-add-mini" aria-hidden="true">+</span>`}
        </div>
      </div>
    `;

    const abrir = () => abrirModalProduto(produto);
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-quick-add]")) return; // tratado à parte, abaixo
      abrir();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
    });

    if (semAdicionais) {
      $("[data-quick-add]", card).addEventListener("click", (e) => {
        e.stopPropagation();
        adicionarRapido(produto);
      });
    }
    return card;
  }

  function adicionarRapido(produto) {
    const item = {
      uid: gerarUidItem(produto.id),
      produtoId: produto.id,
      nome: produto.nome,
      precoBase: produto.preco,
      adicionais: [],
      observacao: "",
      quantidade: 1,
    };
    state.cart.push(item);
    salvarCart();
    renderCartBar();
    mostrarToast(`${produto.nome} adicionado à sacola ✅`);
  }

  // Atualiza o chip ativo conforme o usuário rola a página (IntersectionObserver)
  function observarSecoes() {
    // Se já existe um observer de uma renderização anterior (ex: depois de
    // uma atualização automática do cardápio), desconecta antes de criar
    // outro — evita acumular observers "fantasmas" apontando pra seções
    // que já não existem mais no DOM.
    if (state._sectionsObserver) {
      state._sectionsObserver.disconnect();
      state._sectionsObserver = null;
    }

    const secoes = $$("main section[id^='categoria-']");
    if (!secoes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace("categoria-", "");
            state.categoriaAtiva = id;
            $$(".chip").forEach((chip) =>
              chip.setAttribute("aria-current", chip.dataset.categoria === id ? "true" : "false")
            );
          }
        });
      },
      { rootMargin: "-120px 0px -70% 0px", threshold: 0 }
    );
    secoes.forEach((s) => observer.observe(s));
    state._sectionsObserver = observer;
  }

  /* =====================================================================
     6. MODAL DE PRODUTO
     ===================================================================== */
  function abrirModalProduto(produto) {
    state.produtoEmEdicao = produto;
    const qtdLanches = produto.qtdLanches && produto.qtdLanches > 1 ? produto.qtdLanches : 1;
    state.adicionaisSelecionados = Array.from({ length: qtdLanches }, () => new Set());
    state.quantidadeModal = 1;

    $("#product-modal-photo").src = produto.foto;
    $("#product-modal-photo").alt = produto.nome;
    $("#product-modal-title").textContent = produto.nome;
    $("#product-modal-desc").textContent = produto.descricao;
    $("#product-obs").value = "";

    // Ingredientes (somente informativo)
    const ingredientesWrap = $("#product-ingredientes");
    ingredientesWrap.innerHTML = "";
    (produto.ingredientes || []).forEach((ing) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = ing;
      ingredientesWrap.appendChild(tag);
    });
    $("#product-ingredientes-block").classList.toggle("hidden", !(produto.ingredientes || []).length);

    // Adicionais (checkbox com preço). Alguns produtos têm um subgrupo de
    // "escolha única" (ex: acompanhamento grátis — ou um, ou outro), que é
    // renderizado como radio em vez de checkbox. Combos com mais de um
    // lanche (produto.qtdLanches > 1) repetem o bloco de adicionais uma vez
    // por lanche, cada um com sua própria seleção independente.
    const adicionaisIds = produto.adicionais || [];
    const escolhaUnicaIds = (produto.escolhaUnicaIds || []).filter((id) => adicionaisIds.includes(id));
    const normalIds = adicionaisIds.filter((id) => !escolhaUnicaIds.includes(id));
    const adicionaisBlock = $("#product-adicionais-block");
    const adicionaisLista = $("#product-adicionais-list");

    function renderGrupoLanche(lancheIndex) {
      const setSelecionados = state.adicionaisSelecionados[lancheIndex];
      const wrap = document.createElement("div");
      wrap.className = "addon-lanche-group";

      if (qtdLanches > 1) {
        const tituloLanche = document.createElement("div");
        tituloLanche.className = "addon-group-title";
        tituloLanche.textContent = `Lanche ${lancheIndex + 1}`;
        wrap.appendChild(tituloLanche);
      }

      if (escolhaUnicaIds.length) {
        const jaSelecionado = escolhaUnicaIds.some((id) => setSelecionados.has(id));
        if (!jaSelecionado) setSelecionados.add(escolhaUnicaIds[0]);

        if (produto.escolhaUnicaTitulo) {
          const tituloEl = document.createElement("div");
          tituloEl.className = "addon-group-title";
          tituloEl.textContent = produto.escolhaUnicaTitulo;
          wrap.appendChild(tituloEl);
        }

        escolhaUnicaIds.forEach((id) => {
          const def = state.menu.adicionaisDisponiveis.find((a) => a.id === id);
          if (!def) return;
          const marcado = setSelecionados.has(def.id);
          const row = document.createElement("div");
          row.className = "addon-row";
          row.innerHTML = `
            <div class="addon-check">
              <span class="radio" role="radio" aria-checked="${marcado}" data-addon-id="${def.id}" tabindex="0"></span>
              <span class="addon-label">${escaparHtml(def.nome)}</span>
            </div>
            <span class="addon-price">${def.preco ? "+ " + formatarPreco(def.preco) : "Grátis"}</span>
          `;
          const radioEl = $(".radio", row);
          const selecionar = () => {
            escolhaUnicaIds.forEach((outroId) => setSelecionados.delete(outroId));
            setSelecionados.add(def.id);
            renderAdicionaisLista();
            atualizarPrecoModal();
          };
          radioEl.addEventListener("click", selecionar);
          radioEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selecionar(); }
          });
          wrap.appendChild(row);
        });
      }

      normalIds.forEach((id) => {
        const def = state.menu.adicionaisDisponiveis.find((a) => a.id === id);
        if (!def) return;
        const marcado = setSelecionados.has(def.id);
        const row = document.createElement("div");
        row.className = "addon-row";
        row.innerHTML = `
          <div class="addon-check">
            <span class="checkbox" role="checkbox" aria-checked="${marcado}" data-addon-id="${def.id}" tabindex="0">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a0e07" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <span class="addon-label">${escaparHtml(def.nome)}</span>
          </div>
          <span class="addon-price">+ ${formatarPreco(def.preco)}</span>
        `;
        const checkboxEl = $(".checkbox", row);
        const toggle = () => {
          const ativo = checkboxEl.getAttribute("aria-checked") === "true";
          checkboxEl.setAttribute("aria-checked", String(!ativo));
          if (ativo) setSelecionados.delete(def.id);
          else setSelecionados.add(def.id);
          atualizarPrecoModal();
        };
        checkboxEl.addEventListener("click", toggle);
        checkboxEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        });
        wrap.appendChild(row);
      });

      return wrap;
    }

    function renderAdicionaisLista() {
      adicionaisLista.innerHTML = "";
      for (let i = 0; i < qtdLanches; i++) {
        adicionaisLista.appendChild(renderGrupoLanche(i));
      }
    }

    if (adicionaisIds.length) {
      adicionaisBlock.classList.remove("hidden");
      renderAdicionaisLista();
    } else {
      adicionaisBlock.classList.add("hidden");
    }

    $("#qty-value").textContent = "1";
    atualizarPrecoModal();

    $("#product-overlay").classList.remove("hidden");
    travarScroll(true);
  }

  function fecharModalProduto() {
    $("#product-overlay").classList.add("hidden");
    travarScroll(false);
  }

  function precoUnitarioModal() {
    const produto = state.produtoEmEdicao;
    let preco = produto.preco;
    state.adicionaisSelecionados.forEach((setLanche) => {
      setLanche.forEach((id) => {
        const def = state.menu.adicionaisDisponiveis.find((a) => a.id === id);
        if (def) preco += def.preco;
      });
    });
    return preco;
  }

  function atualizarPrecoModal() {
    const total = precoUnitarioModal() * state.quantidadeModal;
    $("#product-modal-preco").textContent = formatarPreco(total);
  }

  function configurarStepperModal() {
    $("#qty-minus").addEventListener("click", () => {
      state.quantidadeModal = Math.max(1, state.quantidadeModal - 1);
      $("#qty-value").textContent = state.quantidadeModal;
      atualizarPrecoModal();
    });
    $("#qty-plus").addEventListener("click", () => {
      state.quantidadeModal = Math.min(20, state.quantidadeModal + 1);
      $("#qty-value").textContent = state.quantidadeModal;
      atualizarPrecoModal();
    });
  }

  function adicionarAoCarrinhoDoModal() {
    const produto = state.produtoEmEdicao;
    const adicionaisPorLanche = state.adicionaisSelecionados.map((setLanche) =>
      Array.from(setLanche).map((id) =>
        state.menu.adicionaisDisponiveis.find((a) => a.id === id)
      ).filter(Boolean)
    );
    const adicionaisEscolhidos = adicionaisPorLanche.flat(); // [{id, nome, preco}] — soma de todos os lanches

    const item = {
      uid: gerarUidItem(produto.id),
      produtoId: produto.id,
      nome: produto.nome,
      precoBase: produto.preco,
      adicionais: adicionaisEscolhidos,
      // Só guardamos a separação por lanche quando o produto tem mais de 1
      // (evita mudar o formato dos itens de produtos simples já existentes).
      adicionaisPorLanche: adicionaisPorLanche.length > 1 ? adicionaisPorLanche : null,
      observacao: $("#product-obs").value.trim(),
      quantidade: state.quantidadeModal,
    };
    state.cart.push(item);
    salvarCart();
    renderCartBar();
    fecharModalProduto();
    mostrarToast(`${produto.nome} adicionado à sacola ✅`);
  }

  /* =====================================================================
     7. CARRINHO
     ===================================================================== */
  function precoUnitarioItem(item) {
    return item.precoBase + item.adicionais.reduce((acc, a) => acc + a.preco, 0);
  }

  function subtotalCarrinho() {
    const bruto = state.cart.reduce((acc, item) => acc + precoUnitarioItem(item) * item.quantidade, 0);
    return arredondarMoeda(bruto);
  }

  // Bairros/regiões: preferência para menu.taxasEntrega (editável no painel).
  // Fallback para a lista legada caso o JSON ainda não tenha o campo.
  const ZONAS_ENTREGA_FALLBACK = [
    { nome: "Centro", taxa: 5.0 },
    { nome: "Ipê", taxa: 5.0 },
    { nome: "Monte Cristo", taxa: 5.0 },
    { nome: "Jardim da Silveira", taxa: 5.0 },
    { nome: "Sem Terra", taxa: 5.0 },
    { nome: "Benedetti", taxa: 6.0 },
    { nome: "Morada do Lago", taxa: 8.0 },
    { nome: "Lago Azul", taxa: 10.0 },
  ];

  function zonasEntregaAtuais() {
    const lista = state.menu && Array.isArray(state.menu.taxasEntrega) ? state.menu.taxasEntrega : null;
    if (lista && lista.length) {
      return lista.map((z) => ({ nome: z.nome, taxa: Number(z.valor) || 0 }));
    }
    return ZONAS_ENTREGA_FALLBACK;
  }

  function popularSelectBairro() {
    const select = $("#input-bairro");
    if (!select) return;
    const taxaPadrao = (state.menu && state.menu.restaurante.taxaEntrega) || 0;
    const zonas = zonasEntregaAtuais();
    const opcoes = [
      `<option value="" disabled selected>Selecione seu bairro...</option>`,
      ...zonas.map(
        (z) => `<option value="${z.nome}" data-taxa="${z.taxa}">${z.nome} — ${formatarPreco(z.taxa)}</option>`
      ),
      `<option value="Outro" data-taxa="${taxaPadrao}">Outro bairro / cidade vizinha — ${formatarPreco(taxaPadrao)}</option>`,
    ];
    select.innerHTML = opcoes.join("");
  }

  function taxaEntregaAtual() {
    if (state.tipoEntrega === "retirada") return 0;
    const select = $("#input-bairro");
    const opcaoSelecionada = select ? select.selectedOptions[0] : null;
    const taxaData = opcaoSelecionada ? opcaoSelecionada.dataset.taxa : undefined;
    if (taxaData !== undefined && taxaData !== "") return parseFloat(taxaData);
    return state.menu.restaurante.taxaEntrega || 0;
  }

  function buscarCupomPorCodigo(codigo) {
    const lista = (state.menu && state.menu.cupons) || [];
    const norm = String(codigo || "").trim().toUpperCase();
    return lista.find((c) => c.ativo !== false && String(c.codigo || "").toUpperCase() === norm) || null;
  }

  function calcularDescontoCupom() {
    if (!state.cupomAplicado) return 0;
    const sub = subtotalCarrinho();
    const taxa = taxaEntregaAtual();
    const base = sub + taxa;
    const c = state.cupomAplicado;
    let desc = 0;
    if (c.tipo === "percentual") desc = (sub * (Number(c.valor) || 0)) / 100;
    else desc = Number(c.valor) || 0;
    if (desc > base) desc = base;
    return arredondarMoeda(Math.max(0, desc));
  }

  function calcularDescontoRoleta() {
    const p = state.premioRoleta;
    if (!p || p.tipo !== "desconto_percentual") return 0;
    const sub = subtotalCarrinho();
    const desc = (sub * (Number(p.valor) || 0)) / 100;
    return arredondarMoeda(Math.max(0, desc));
  }

  function totalCarrinho() {
    return arredondarMoeda(Math.max(0,
      subtotalCarrinho() + taxaEntregaAtual() - calcularDescontoCupom() - calcularDescontoRoleta()
    ));
  }

  function atualizarSecaoPremiosCheckout() {
    const secao = $("#secao-premios-roleta");
    const lista = $("#lista-premios-checkout");
    if (!secao || !lista) return;
    const premios = (window.BRUTUS_ROLETA && window.BRUTUS_ROLETA.getPremiosDisponiveis)
      ? window.BRUTUS_ROLETA.getPremiosDisponiveis()
      : [];
    if (!premios.length) {
      secao.classList.add("hidden");
      state.premioRoleta = null;
      return;
    }
    secao.classList.remove("hidden");
    const selectedId = state.premioRoleta && state.premioRoleta.id;
    lista.innerHTML = `
      <label class="premio-checkout-opt ${!selectedId ? "selected" : ""}">
        <input type="radio" name="premio-roleta" value="" ${!selectedId ? "checked" : ""}>
        <span>Não usar prêmio neste pedido</span>
      </label>
      ${premios.map((p) => `
        <label class="premio-checkout-opt ${selectedId === p.id ? "selected" : ""}">
          <input type="radio" name="premio-roleta" value="${escaparHtml(p.id)}" ${selectedId === p.id ? "checked" : ""}>
          <span>${escaparHtml(p.icone || "🎁")} ${escaparHtml(p.nome)}</span>
        </label>
      `).join("")}
    `;
    lista.querySelectorAll('input[name="premio-roleta"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        const id = inp.value;
        if (!id) {
          state.premioRoleta = null;
        } else {
          state.premioRoleta = premios.find((x) => x.id === id) || null;
        }
        lista.querySelectorAll(".premio-checkout-opt").forEach((el) => {
          el.classList.toggle("selected", el.querySelector("input")?.checked);
        });
        renderCarrinho();
        renderCartBar();
      });
    });
  }

  function aplicarCupomDoInput() {
    const input = $("#input-cupom");
    const erro = $("#cupom-erro");
    const ok = $("#cupom-ok");
    if (!input) return;
    const codigo = input.value.trim().toUpperCase();
    if (erro) { erro.style.display = "none"; erro.textContent = ""; }
    if (ok) { ok.style.display = "none"; ok.textContent = ""; }

    if (!codigo) {
      state.cupomAplicado = null;
      renderCarrinho();
      renderCartBar();
      return;
    }
    const cupom = buscarCupomPorCodigo(codigo);
    if (!cupom) {
      state.cupomAplicado = null;
      if (erro) { erro.style.display = "block"; erro.textContent = "Cupom inválido ou inativo."; }
      renderCarrinho();
      renderCartBar();
      return;
    }
    const min = Number(cupom.minimo) || 0;
    if (subtotalCarrinho() < min) {
      state.cupomAplicado = null;
      if (erro) {
        erro.style.display = "block";
        erro.textContent = `Pedido mínimo de ${formatarPreco(min)} para este cupom.`;
      }
      renderCarrinho();
      renderCartBar();
      return;
    }
    if (cupom.usoMaximo > 0 && (cupom.usos || 0) >= cupom.usoMaximo) {
      state.cupomAplicado = null;
      if (erro) { erro.style.display = "block"; erro.textContent = "Cupom esgotado."; }
      renderCarrinho();
      renderCartBar();
      return;
    }
    state.cupomAplicado = {
      codigo: cupom.codigo,
      tipo: cupom.tipo,
      valor: cupom.valor,
      id: cupom.id,
    };
    if (ok) {
      ok.style.display = "block";
      ok.textContent = cupom.descricao || "Cupom aplicado!";
    }
    renderCarrinho();
    renderCartBar();
    mostrarToast("Cupom aplicado!", 1800, "sucesso");
  }

  function renderCartBar() {
    const totalItens = state.cart.reduce((acc, i) => acc + i.quantidade, 0);
    const cartBar = $("#cart-bar");
    if (totalItens === 0) {
      cartBar.classList.add("hidden");
      return;
    }
    cartBar.classList.remove("hidden");
    $("#cart-bar-badge").textContent = totalItens;
    $("#cart-bar-total").textContent = formatarPreco(subtotalCarrinho());
  }

  // Mostra, na sacola vazia, um atalho pra repetir o último pedido salvo
  // localmente (ver salvarUltimoPedido). Recria os itens na sacola atual
  // usando os preços/produtos de HOJE — se algum item saiu do cardápio
  // nesse meio tempo, ele é simplesmente ignorado (sem travar o resto).
  function renderSugestaoUltimoPedido() {
    const container = $("#cart-ultimo-pedido");
    if (!container) return;
    const ultimo = carregarUltimoPedido();
    if (!ultimo || !ultimo.itens?.length) {
      container.classList.add("hidden");
      container.innerHTML = "";
      return;
    }

    const listaItens = ultimo.itens.map((i) => `${Number(i.quantidade) || 1}x ${escaparHtml(i.nome)}`).join(", ");
    container.innerHTML = `
      <div class="ultimo-pedido-sugestao">
        <strong>Pedir de novo?</strong>
        <p>${listaItens} — ${formatarPreco(ultimo.total)}</p>
        <button type="button" id="btn-repetir-pedido">Adicionar itens do último pedido</button>
      </div>
    `;
    container.classList.remove("hidden");

    $("#btn-repetir-pedido", container).addEventListener("click", () => {
      let adicionados = 0;
      ultimo.itens.forEach((i) => {
        const produto = state.menu.produtos.find((p) => p.id === i.produtoId);
        if (!produto || !produtoVisivelNoCardapio(produto)) return; // saiu do cardápio ou indisponível
        state.cart.push({
          uid: gerarUidItem(produto.id),
          produtoId: produto.id,
          nome: produto.nome,
          precoBase: produto.preco,
          adicionais: [],
          observacao: "",
          quantidade: i.quantidade || 1,
        });
        adicionados++;
      });
      if (adicionados === 0) {
        mostrarToast("Esses itens não estão mais disponíveis no cardápio.");
        return;
      }
      salvarCart();
      renderCartBar();
      renderCarrinho();
      mostrarToast("Itens do último pedido adicionados à sacola ✅");
    });
  }

  function renderCarrinho() {
    const vazio = state.cart.length === 0;
    $("#cart-empty-view").classList.toggle("hidden", !vazio);
    $("#cart-filled-view").classList.toggle("hidden", vazio);

    if (vazio) renderSugestaoUltimoPedido();

    const infoHorario = obterInfoHorario(state.menu.restaurante.horario);
    $("#cart-loja-fechada-aviso").classList.toggle("hidden", infoHorario.aberto);
    if (!infoHorario.aberto) {
      const msg = infoHorario.texto === "Fechado hoje"
        ? "⚠️ A loja está fechada hoje. Você pode montar o pedido, mas só poderá enviá-lo quando reabrirmos."
        : `⚠️ A loja está fechada no momento (${infoHorario.texto.replace("Fechado agora · ", "")}). Você pode montar o pedido, mas só poderá enviá-lo quando reabrirmos.`;
      $("#cart-loja-fechada-aviso").textContent = msg;
    }

    if (vazio) return;

    const lista = $("#cart-items-list");
    lista.innerHTML = "";
    state.cart.forEach((item) => {
      const el = document.createElement("div");
      el.className = "cart-item";
      const adicionaisTxt = item.adicionaisPorLanche
        ? item.adicionaisPorLanche
            .map((grupo, i) => (grupo.length ? `Lanche ${i + 1}: ${grupo.map((a) => escaparHtml(a.nome)).join(", ")}` : null))
            .filter(Boolean)
            .join("<br>")
        : item.adicionais.map((a) => `+ ${escaparHtml(a.nome)}`).join("<br>");
      el.innerHTML = `
        <span class="cart-item-qty">${item.quantidade}x</span>
        <div class="cart-item-info">
          <div class="cart-item-name">${escaparHtml(item.nome)}</div>
          ${adicionaisTxt ? `<div class="cart-item-addons">${adicionaisTxt}</div>` : ""}
          ${item.observacao ? `<div class="cart-item-obs">Obs: ${escaparHtml(item.observacao)}</div>` : ""}
        </div>
        <div class="cart-item-side">
          <span class="cart-item-price">${formatarPreco(precoUnitarioItem(item) * item.quantidade)}</span>
          <div class="mini-stepper">
            <button class="mini-qty-btn" type="button" data-action="menos" aria-label="Diminuir quantidade de ${escaparHtml(item.nome)}">−</button>
            <span class="mini-qty-value">${item.quantidade}</span>
            <button class="mini-qty-btn" type="button" data-action="mais" aria-label="Aumentar quantidade de ${escaparHtml(item.nome)}">+</button>
          </div>
          <button class="cart-item-remove" data-uid="${escaparHtml(item.uid)}" type="button">remover</button>
        </div>
      `;
      $(".cart-item-remove", el).addEventListener("click", () => removerDoCarrinho(item.uid));
      $$(".mini-qty-btn", el).forEach((btn) => {
        btn.addEventListener("click", () => {
          const delta = btn.dataset.action === "mais" ? 1 : -1;
          alterarQuantidadeCarrinho(item.uid, delta);
        });
      });
      lista.appendChild(el);
    });

    $("#cart-subtotal").textContent = formatarPreco(subtotalCarrinho());
    $("#cart-taxa-row").classList.toggle("hidden", state.tipoEntrega === "retirada");
    $("#cart-taxa").textContent = formatarPreco(taxaEntregaAtual());
    const desconto = calcularDescontoCupom() + calcularDescontoRoleta();
    const rowDesc = $("#cart-desconto-row");
    if (rowDesc) {
      rowDesc.classList.toggle("hidden", desconto <= 0);
      $("#cart-desconto").textContent = "− " + formatarPreco(desconto);
      const lab = $("#cart-cupom-label");
      if (lab) {
        const parts = [];
        if (state.cupomAplicado) parts.push(state.cupomAplicado.codigo);
        if (state.premioRoleta && state.premioRoleta.tipo === "desconto_percentual") parts.push("Roleta");
        lab.textContent = parts.length ? `(${parts.join(" + ")})` : "";
      }
    }
    $("#cart-total").textContent = formatarPreco(totalCarrinho());
    const fin = $("#finalize-total");
    if (fin) fin.textContent = formatarPreco(totalCarrinho());
    atualizarTrocoCalculado();
    atualizarPix();
    atualizarSecaoPremiosCheckout();
  }

  function removerDoCarrinho(uid) {
    state.cart = state.cart.filter((i) => i.uid !== uid);
    salvarCart();
    renderCarrinho();
    renderCartBar();
  }

  function alterarQuantidadeCarrinho(uid, delta) {
    const item = state.cart.find((i) => i.uid === uid);
    if (!item) return;
    item.quantidade += delta;
    if (item.quantidade <= 0) {
      removerDoCarrinho(uid);
      return;
    }
    salvarCart();
    renderCarrinho();
    renderCartBar();
  }

  function abrirCarrinho() {
    const tel = ($("#input-telefone")?.value || "").replace(/\D/g, "");
    if (tel && window.BRUTUS_ROLETA && window.BRUTUS_ROLETA.refresh) {
      try {
        localStorage.setItem("brutus-roleta-tel", tel);
      } catch (e) {}
      window.BRUTUS_ROLETA.refresh();
      setTimeout(() => atualizarSecaoPremiosCheckout(), 400);
    }
    renderCarrinho();
    esconderAvisoPopupBloqueado();
    $("#cart-overlay").classList.remove("hidden");
    travarScroll(true);
  }

  function fecharCarrinho() {
    $("#cart-overlay").classList.add("hidden");
    travarScroll(false);
  }

  /* =====================================================================
     8. CHECKOUT
     ===================================================================== */
  function configurarEntregaRetirada() {
    const btnEntrega = $("#opt-entrega");
    const btnRetirada = $("#opt-retirada");
    const enderecoSection = $("#endereco-section");

    function aplicar(tipo) {
      state.tipoEntrega = tipo;
      btnEntrega.setAttribute("aria-pressed", String(tipo === "entrega"));
      btnRetirada.setAttribute("aria-pressed", String(tipo === "retirada"));
      enderecoSection.classList.toggle("hidden", tipo === "retirada");
      renderCarrinho();
    }
    btnEntrega.addEventListener("click", () => aplicar("entrega"));
    btnRetirada.addEventListener("click", () => aplicar("retirada"));
  }

  function atualizarTrocoCalculado() {
    const resultado = $("#troco-resultado");
    const valorDigitado = $("#input-troco").value.trim();

    if (!valorDigitado) {
      resultado.classList.add("hidden");
      resultado.classList.remove("troco-ok", "troco-erro");
      resultado.textContent = "";
      return;
    }

    const valorPago = arredondarMoeda(parseValorBR(valorDigitado));
    const total = totalCarrinho();

    resultado.classList.remove("hidden");

    if (isNaN(valorPago)) {
      resultado.classList.add("troco-erro");
      resultado.classList.remove("troco-ok");
      resultado.textContent = "Valor inválido.";
      return;
    }

    if (valorPago < total) {
      resultado.classList.add("troco-erro");
      resultado.classList.remove("troco-ok");
      resultado.textContent = `Valor menor que o total do pedido (${formatarPreco(total)}).`;
      return;
    }

    const troco = arredondarMoeda(valorPago - total);
    resultado.classList.add("troco-ok");
    resultado.classList.remove("troco-erro");
    resultado.textContent = troco > 0
      ? `Troco: ${formatarPreco(troco)}`
      : "Sem troco (valor exato).";
  }

  /* =====================================================================
     8.1 PIX — geração do código "copia e cola" (padrão EMV / Bacen) e QR
     ===================================================================== */
  let pixQrInstance = null;

  function crc16Pix(payload) {
    let resultado = 0xffff;
    for (let i = 0; i < payload.length; i++) {
      resultado ^= payload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        resultado = (resultado & 0x8000) ? ((resultado << 1) ^ 0x1021) : (resultado << 1);
        resultado &= 0xffff;
      }
    }
    return resultado.toString(16).toUpperCase().padStart(4, "0");
  }

  function campoEmv(id, valor) {
    const tamanho = String(valor.length).padStart(2, "0");
    return `${id}${tamanho}${valor}`;
  }

  function formatarChavePix(chave, tipo) {
    const bruto = String(chave || "").trim();
    const digitos = bruto.replace(/\D/g, "");

    if (tipo === "cpf" && digitos.length === 11) {
      return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
    }
    if (tipo === "cnpj" && digitos.length === 14) {
      return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
    }
    if (tipo === "telefone") {
      if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
      if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
    }
    // email ou chave aleatória: exibe como cadastrado
    return bruto;
  }

  function chavePixParaPayload(chave, tipo) {
    const digitos = String(chave || "").replace(/\D/g, "");
    if (tipo === "telefone") return `+55${digitos}`;
    if (tipo === "cpf" || tipo === "cnpj") return digitos;
    return String(chave || "").trim();
  }

  function removerAcentos(txt) {
    return txt.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function gerarPayloadPix({ chave, nome, cidade, valor, txid }) {
    const nomeLimpo = removerAcentos(nome).toUpperCase().substring(0, 25);
    const cidadeLimpa = removerAcentos(cidade).toUpperCase().substring(0, 15);
    const txidLimpo = (txid || "***").substring(0, 25);

    const merchantAccount = campoEmv("00", "br.gov.bcb.pix") + campoEmv("01", chave);
    const partes = [
      campoEmv("00", "01"),                          // Payload Format Indicator
      campoEmv("26", merchantAccount),                // Merchant Account Info (Pix)
      campoEmv("52", "0000"),                         // Merchant Category Code
      campoEmv("53", "986"),                          // Moeda (BRL)
    ];
    if (valor && valor > 0) {
      partes.push(campoEmv("54", valor.toFixed(2)));  // Valor da transação
    }
    partes.push(
      campoEmv("58", "BR"),                           // País
      campoEmv("59", nomeLimpo),                       // Nome do recebedor
      campoEmv("60", cidadeLimpa),                     // Cidade
      campoEmv("62", campoEmv("05", txidLimpo)),        // Dados adicionais (txid)
    );

    const payloadSemCrc = partes.join("") + "6304";
    return payloadSemCrc + crc16Pix(payloadSemCrc);
  }

  const PIX_TIPO_LABEL = {
    cpf: "CPF",
    cnpj: "CNPJ",
    telefone: "celular",
    email: "e-mail",
    aleatoria: "aleatória",
  };

  function atualizarPix() {
    const pix = state.menu?.restaurante?.pix;
    const container = $("#pix-info");
    if (!pix || !pix.chave || !container) {
      if (container) container.classList.add("hidden");
      return;
    }

    const visivel = state.formaPagamento === "PIX";
    container.classList.toggle("hidden", !visivel);
    if (!visivel) return;

    const rotuloTipo = PIX_TIPO_LABEL[pix.tipo] || "Pix";
    const tituloEl = $("#pix-tipo-titulo");
    if (tituloEl) tituloEl.textContent = `Pague com Pix (${rotuloTipo})`;
    const labelEl = $("#pix-tipo-label");
    if (labelEl) labelEl.textContent = `Chave (${rotuloTipo})`;

    const total = totalCarrinho();
    $("#pix-valor").textContent = formatarPreco(total);
    $("#pix-chave-display").textContent = formatarChavePix(pix.chave, pix.tipo);

    const payload = gerarPayloadPix({
      chave: chavePixParaPayload(pix.chave, pix.tipo),
      nome: pix.titular || state.menu.restaurante.nome,
      cidade: pix.cidade || "",
      valor: total,
      txid: "BRUTUSDELIVERY",
    });

    const qrEl = $("#pix-qrcode");
    if (window.QRCode && qrEl) {
      qrEl.innerHTML = "";
      pixQrInstance = new QRCode(qrEl, {
        text: payload,
        width: 150,
        height: 150,
        colorDark: "#14100d",
        colorLight: "#ffffff",
      });
    }

    container.dataset.payload = payload;
  }

  function configurarPixCopiarColar() {
    async function copiar(texto, mensagem) {
      try {
        await navigator.clipboard.writeText(texto);
        mostrarToast(mensagem);
      } catch (e) {
        mostrarToast("Não foi possível copiar. Copie manualmente.");
      }
    }

    $("#pix-copiar-chave")?.addEventListener("click", () => {
      const pix = state.menu?.restaurante?.pix;
      if (pix) copiar(chavePixParaPayload(pix.chave, pix.tipo), "Chave Pix copiada!");
    });

    $("#pix-copiar-codigo")?.addEventListener("click", () => {
      const payload = $("#pix-info")?.dataset.payload;
      if (payload) copiar(payload, "Código Pix copiado! Cole no app do seu banco.");
    });
  }

  function configurarFormaPagamento() {
    const opcoes = $$(".payment-option");
    opcoes.forEach((opt) => {
      opt.addEventListener("click", () => {
        opcoes.forEach((o) => o.setAttribute("aria-pressed", "false"));
        opt.setAttribute("aria-pressed", "true");
        state.formaPagamento = opt.dataset.pagamento;
        $("#troco-field").classList.toggle("hidden", state.formaPagamento !== "Dinheiro");
        atualizarTrocoCalculado();
        atualizarPix();
      });
    });

    $("#input-troco").addEventListener("input", atualizarTrocoCalculado);
    configurarPixCopiarColar();

    const inputBairro = $("#input-bairro");
    if (inputBairro) {
      inputBairro.addEventListener("change", () => {
        renderCarrinho();
        renderCartBar();
        atualizarPix();
      });
    }
  }

  function preencherDadosClienteSalvos() {
    const dados = carregarDadosCliente();
    if (!dados) return;
    if (dados.nome) $("#input-nome").value = dados.nome;
    if (dados.telefone) $("#input-telefone").value = dados.telefone;
    if (dados.endereco) $("#input-endereco").value = dados.endereco;
    if (dados.numero) $("#input-numero").value = dados.numero;
    if (dados.bairro) $("#input-bairro").value = dados.bairro;
    if (dados.referencia) $("#input-referencia").value = dados.referencia;
  }

  function validarFormulario() {
    let valido = true;
    const camposObrigatorios = [
      { id: "input-nome" },
      { id: "input-telefone" },
    ];
    if (state.tipoEntrega === "entrega") {
      camposObrigatorios.push({ id: "input-endereco" }, { id: "input-numero" }, { id: "input-bairro" });
    }
    camposObrigatorios.forEach(({ id }) => {
      const input = document.getElementById(id);
      const field = input.closest(".field");
      const preenchido = input.value.trim().length > 0;
      field.classList.toggle("invalid", !preenchido);
      if (!preenchido) valido = false;
    });
    return valido;
  }

  /* =====================================================================
     9. MONTAGEM DA MENSAGEM E ENVIO PARA O WHATSAPP
     ===================================================================== */
  // Número legível compartilhado entre API, painel, impressão e WhatsApp.
  function gerarNumeroPedido() {
    const agora = new Date();
    const data = [agora.getFullYear(), String(agora.getMonth() + 1).padStart(2, "0"), String(agora.getDate()).padStart(2, "0")].join("");
    const sequencia = String((Date.now() % 10000)).padStart(4, "0");
    return `BRU-${data}-${sequencia}`;
  }

  function apiPedidosBase() {
    const cfg = window.SITE_CONFIG || {};
    return String(cfg.onlineApiBase || cfg.apiBase || "").replace(/\/$/, "");
  }

  function lerPedidosPendentes() {
    try { return JSON.parse(localStorage.getItem(PENDING_ORDERS_STORAGE_KEY) || "[]"); }
    catch (e) { return []; }
  }

  function salvarPedidosPendentes(lista) {
    try { localStorage.setItem(PENDING_ORDERS_STORAGE_KEY, JSON.stringify(lista.slice(-20))); } catch (e) {}
  }

  async function enviarPedidoOnline(pedido, avisarFalha = true) {
    const base = apiPedidosBase();
    if (!base && window.location.protocol === "file:") return false;
    try {
      const res = await fetch(base + "/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedido),
        keepalive: true,
      });
      if (!res.ok) throw new Error("API HTTP " + res.status);
      salvarPedidosPendentes(lerPedidosPendentes().filter((p) => p.id !== pedido.id));
      return true;
    } catch (e) {
      if (avisarFalha) mostrarToast("Pedido não sincronizou agora, mas o WhatsApp continua funcionando.", 4200);
      return false;
    }
  }

  function registrarPedidoOnlineSemBloquearWhatsapp(pedido) {
    const pendentes = lerPedidosPendentes().filter((p) => p.id !== pedido.id);
    pendentes.push(pedido);
    salvarPedidosPendentes(pendentes);
    // Não aguardamos: mantém a abertura do WhatsApp dentro do toque do cliente.
    void enviarPedidoOnline(pedido, true);
  }

  async function sincronizarPedidosPendentes() {
    if (!navigator.onLine) return;
    for (const pedido of lerPedidosPendentes()) {
      await enviarPedidoOnline(pedido, false);
    }
  }

  function montarMensagemPedido(dadosCliente, numeroPedido) {
    const r = state.menu.restaurante;
    const linhas = [];
    const agora = new Date();
    const dataHora = agora.toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });

    linhas.push(`🍔 *NOVO PEDIDO — ${r.nome}*`, "");
    linhas.push(`🆔 *Pedido #${numeroPedido}*`);
    linhas.push(`🕐 *Horário do pedido:* ${dataHora}`);
    linhas.push(`_(hora em que o cliente finalizou o pedido no cardápio — pode ser diferente da hora que esta mensagem chegou aqui, caso o envio tenha demorado)_`);
    if (r.tempoEstimado) linhas.push(`⏱️ *Previsão:* ${r.tempoEstimado}`);
    linhas.push("");
    linhas.push(`👤 *Cliente:*`, dadosCliente.nome, "");
    linhas.push(`📞 *Telefone:*`, dadosCliente.telefone, "");

    if (state.tipoEntrega === "entrega") {
      linhas.push(`📍 *Endereço de entrega:*`);
      linhas.push(`${dadosCliente.endereco}, ${dadosCliente.numero}`);
      linhas.push(dadosCliente.bairro);
      if (dadosCliente.referencia) linhas.push(`Referência: ${dadosCliente.referencia}`);
      linhas.push("");
    } else {
      linhas.push(`🏃 *Retirada no local:*`, r.enderecoRetirada || "Retirar no balcão", "");
    }

    linhas.push(`🛒 *PEDIDO*`);
    state.cart.forEach((item) => {
      linhas.push(`${item.quantidade}x ${item.nome}`);
      if (item.adicionaisPorLanche) {
        item.adicionaisPorLanche.forEach((grupo, i) => {
          if (!grupo.length) return;
          linhas.push(`   Lanche ${i + 1}:`);
          grupo.forEach((a) => linhas.push(`      + ${a.nome}`));
        });
      } else {
        item.adicionais.forEach((a) => linhas.push(`   + ${a.nome}`));
      }
      if (item.observacao) linhas.push(`   Obs: ${item.observacao}`);
    });
    linhas.push("");

    linhas.push(`💰 *Forma de pagamento:*`);
    if (state.formaPagamento === "Dinheiro" && dadosCliente.troco) {
      const valorPago = arredondarMoeda(parseValorBR(dadosCliente.troco));
      const total = totalCarrinho();
      linhas.push(`Dinheiro — Vai pagar com ${isNaN(valorPago) ? dadosCliente.troco : formatarPreco(valorPago)}`);
      if (!isNaN(valorPago) && valorPago >= total) {
        const troco = arredondarMoeda(valorPago - total);
        linhas.push(troco > 0 ? `Troco: ${formatarPreco(troco)}` : `Sem troco (valor exato)`);
      }
    } else if (state.formaPagamento === "PIX") {
      linhas.push("PIX");
    } else {
      linhas.push(state.formaPagamento);
    }
    linhas.push("");

    linhas.push(`🧾 Subtotal: ${formatarPreco(subtotalCarrinho())}`);
    if (state.tipoEntrega === "entrega") {
      linhas.push(`🛵 Taxa de entrega: ${formatarPreco(taxaEntregaAtual())}`);
    }
    const descontoMsg = calcularDescontoCupom();
    if (descontoMsg > 0 && state.cupomAplicado) {
      linhas.push(`🏷️ Desconto (${state.cupomAplicado.codigo}): − ${formatarPreco(descontoMsg)}`);
    }
    if (state.premioRoleta) {
      const pr = state.premioRoleta;
      if (pr.tipo === "desconto_percentual") {
        linhas.push(`🎰 Prêmio roleta (${pr.nome}): − ${formatarPreco(calcularDescontoRoleta())}`);
      } else if (pr.tipo === "produto_gratis") {
        linhas.push(`🎰 Prêmio roleta: ${pr.icone || ""} ${pr.nome} (grátis)`);
      }
    }
    linhas.push(`💵 *Total: ${formatarPreco(totalCarrinho())}*`, "");

    if (dadosCliente.observacaoGeral) {
      linhas.push(`📝 *Observação:*`, dadosCliente.observacaoGeral, "");
    }

    linhas.push(`Obrigado pela preferência! 🙌`);
    return linhas.join("\n");
  }

  // wa.me e o navegador têm limite de tamanho pra URL. Passado esse ponto,
  // o texto pode chegar cortado (ou o link simplesmente não abrir) — então,
  // em vez de arriscar perder metade do pedido, mandamos só um resumo pelo
  // link e copiamos o pedido completo pra área de transferência, com um
  // aviso pedindo pro cliente colar (Ctrl+V) o texto completo no WhatsApp.
  const LIMITE_CARACTERES_URL = 1800;

  function montarMensagemResumida(dadosCliente, numeroPedido) {
    const linhas = [];
    linhas.push(`🍔 *NOVO PEDIDO — ${state.menu.restaurante.nome}*`);
    linhas.push(`🆔 *Pedido #${numeroPedido}*`, "");
    linhas.push(`👤 ${dadosCliente.nome}`);
    linhas.push(`💵 Total: ${formatarPreco(totalCarrinho())}`, "");
    linhas.push(`⚠️ Pedido grande — os itens completos foram copiados.`);
    linhas.push(`*Cole aqui (Ctrl+V ou toque e segure > Colar) antes de enviar!*`);
    return linhas.join("\n");
  }

  // Guarda o texto do pedido mais recente para os botões de "copiar pedido"
  // (usados tanto no aviso de pop-up bloqueado quanto no aviso de pedido
  // grande) sempre terem o texto completo à mão, sem precisar remontá-lo.
  let ultimoPedidoTextoCompleto = "";
  let ultimoNumeroPedido = "";

  function copiarTextoPedido(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto)
        .then(() => mostrarToast("Pedido copiado! Cole no WhatsApp para enviar."))
        .catch(() => mostrarToast("Não foi possível copiar automaticamente. Selecione e copie o texto manualmente."));
    } else {
      mostrarToast("Não foi possível copiar automaticamente. Selecione e copie o texto manualmente.");
    }
  }

  let enviandoPedido = false;
  let tentativaFinalizacaoAtual = null;

  function travarBotaoFinalizar() {
    enviandoPedido = true;
    const btn = $("#finalizar-btn");
    if (btn) btn.disabled = true;
  }

  function destravarBotaoFinalizar() {
    enviandoPedido = false;
    // Não reabilita direto: o botão só volta a ficar disponível se o
    // checkbox de confirmação de leitura continuar marcado.
    atualizarEstadoBotaoFinalizar();
  }

  // Mantém o botão "Abrir WhatsApp para Enviar Pedido" travado (e com
  // opacidade reduzida, via CSS de :disabled) enquanto o cliente não marcar
  // o checkbox de que leu o aviso. Também mostra/esconde o textinho de dica.
  function atualizarEstadoBotaoFinalizar() {
    const btn = $("#finalizar-btn");
    const checkbox = $("#checkbox-confirmar-envio");
    const hint = $("#checkout-confirm-hint");
    const marcado = checkbox ? checkbox.checked : true;
    if (btn && !enviandoPedido) btn.disabled = !marcado;
    if (hint) hint.classList.toggle("hidden", marcado);
  }

  // Exibe o modal de confirmação depois que o WhatsApp foi aberto. A sacola
  // só é esvaziada quando o cliente fechar esse modal (função abaixo) —
  // enquanto o modal estiver na tela, o pedido continua guardado, caso o
  // cliente feche o WhatsApp sem enviar e precise tentar de novo.
  function abrirModalPedidoEnviado() {
    const overlay = $("#order-modal-overlay");
    if (overlay) overlay.classList.remove("hidden");
  }

  function fecharModalPedidoEnviado() {
    const overlay = $("#order-modal-overlay");
    if (overlay) overlay.classList.add("hidden");

    // Só agora o pedido "sai" da sacola do cliente: o WhatsApp já foi
    // aberto e o cliente confirmou que viu o aviso de que ainda precisa
    // tocar em "Enviar" por lá.
    state.cart = [];
    tentativaFinalizacaoAtual = null;
    salvarCart();
    renderCartBar();
    esconderAvisoPopupBloqueado();
    fecharCarrinho();

    // Reseta o checkbox de confirmação para o próximo pedido — cada envio
    // exige que o cliente confirme a leitura de novo.
    const checkbox = $("#checkbox-confirmar-envio");
    if (checkbox) checkbox.checked = false;
    atualizarEstadoBotaoFinalizar();

    mostrarToast('Lembre-se: o pedido só chega ao restaurante depois que você tocar em "Enviar" no WhatsApp.', 4000, "sucesso");

    // Se uma atualização de versão ficou esperando porque havia um pedido
    // em andamento, agora que ele foi concluído (sacola vazia) é seguro
    // aplicar sozinho — sem precisar que o cliente toque no aviso.
    if ($("#toast-nova-versao") && podeAtualizarAutomaticamente()) {
      window.location.reload();
    }
  }

  function finalizarPedido() {
    // Trava logo de cara: evita que um duplo clique rápido dispare o
    // envio duas vezes (duas janelas/abas do WhatsApp, duas mensagens).
    if (enviandoPedido) return;
    if (state.cart.length === 0) return;

    // Defesa extra: o botão já fica desabilitado enquanto o checkbox não
    // está marcado, mas checamos de novo aqui para não depender só do
    // atributo "disabled" do botão.
    const checkboxConfirmar = $("#checkbox-confirmar-envio");
    if (checkboxConfirmar && !checkboxConfirmar.checked) {
      mostrarToast("Marque a confirmação de leitura antes de enviar o pedido.");
      return;
    }

    // Loja fechada: avisa claramente e não deixa enviar o pedido, para
    // evitar pedidos entrando fora do horário de atendimento.
    if (!calcularStatusAberto(state.menu.restaurante.horario)) {
      mostrarToast("A loja está fechada no momento. Tente novamente durante o horário de atendimento.");
      return;
    }

    if (!validarFormulario()) {
      mostrarToast("Confira os campos destacados em vermelho.");
      return;
    }

    const telefoneDigitado = $("#input-telefone").value.replace(/\D/g, "");
    if (telefoneDigitado.length !== 10 && telefoneDigitado.length !== 11) {
      const campoTelefone = $("#input-telefone");
      const fieldTelefone = campoTelefone.closest(".field");
      if (fieldTelefone) fieldTelefone.classList.add("invalid");
      campoTelefone.focus();
      mostrarToast("Informe o WhatsApp com DDD (10 ou 11 números). Exemplo: 34999999999.");
      return;
    }

    travarBotaoFinalizar();

    const dadosCliente = {
      nome: $("#input-nome").value.trim(),
      telefone: $("#input-telefone").value.trim(),
      endereco: $("#input-endereco").value.trim(),
      numero: $("#input-numero").value.trim(),
      bairro: $("#input-bairro").value.trim(),
      referencia: $("#input-referencia").value.trim(),
      troco: $("#input-troco").value.trim(),
      observacaoGeral: $("#input-observacao-geral").value.trim(),
    };
    salvarDadosCliente(dadosCliente);

    if (!tentativaFinalizacaoAtual) {
      tentativaFinalizacaoAtual = {
        id: "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
        numero: gerarNumeroPedido(),
        ts: Date.now(),
      };
    }
    const numeroPedido = tentativaFinalizacaoAtual.numero;
    const mensagem = montarMensagemPedido(dadosCliente, numeroPedido);
    ultimoPedidoTextoCompleto = mensagem;
    ultimoNumeroPedido = numeroPedido;

    // Registro local + envio para API (quando o backend estiver no ar)
    // Se prêmio for produto grátis, inclui no pedido como item R$ 0
    let itensPedido = state.cart.map((i) => ({
      produtoId: i.produtoId,
      nome: i.nome,
      quantidade: i.quantidade,
      preco: precoUnitarioItem(i),
      adicionaisIds: (i.adicionais || []).map((a) => a.id),
      adicionaisPorLancheIds: Array.isArray(i.adicionaisPorLanche)
        ? i.adicionaisPorLanche.map((grupo) => grupo.map((a) => a.id))
        : null,
      observacao: i.observacao || "",
    }));
    if (state.premioRoleta && state.premioRoleta.tipo === "produto_gratis") {
      const menuProd = (state.menu.produtos || []).find((p) => p.id === state.premioRoleta.produtoId);
      itensPedido.push({
        produtoId: state.premioRoleta.produtoId,
        nome: (menuProd && menuProd.nome) || state.premioRoleta.nome,
        quantidade: 1,
        preco: 0,
        premioRoleta: true,
      });
    }

    const snapshotPedido = {
      id: tentativaFinalizacaoAtual.id,
      numero: numeroPedido,
      ts: tentativaFinalizacaoAtual.ts,
      status: "recebido",
      total: totalCarrinho(),
      subtotal: subtotalCarrinho(),
      taxa: taxaEntregaAtual(),
      desconto: calcularDescontoCupom() + calcularDescontoRoleta(),
      cupom: state.cupomAplicado ? state.cupomAplicado.codigo : null,
      premioRoletaId: state.premioRoleta ? state.premioRoleta.id : null,
      premioRoletaNome: state.premioRoleta ? state.premioRoleta.nome : null,
      cliente: dadosCliente.nome,
      telefone: dadosCliente.telefone,
      tipoEntrega: state.tipoEntrega,
      formaPagamento: state.formaPagamento,
      endereco: [dadosCliente.endereco, dadosCliente.numero].filter(Boolean).join(", "),
      bairro: dadosCliente.bairro || "",
      complemento: dadosCliente.referencia || "",
      referencia: dadosCliente.referencia || "",
      troco: dadosCliente.troco || "",
      observacao: dadosCliente.observacaoGeral || "",
      itens: itensPedido,
    };

    // O prêmio é validado e consumido atomicamente pelo próprio endpoint do
    // pedido. Não fazemos uma chamada separada que poderia gastar o prêmio
    // antes de o pedido chegar ao servidor.
    try {
      const PEDIDOS_KEY = "brutus-pedidos:v1";
      const lista = JSON.parse(localStorage.getItem(PEDIDOS_KEY) || "[]");
      lista.unshift(snapshotPedido);
      const limiteData = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const recentes = lista.filter((p) => Number(p.ts) >= limiteData).slice(0, 50);
      localStorage.setItem(PEDIDOS_KEY, JSON.stringify(recentes));
    } catch (e) {}
    salvarUltimoPedido({
      numero: numeroPedido,
      nome: dadosCliente.nome,
      itens: state.cart.map((i) => ({ produtoId: i.produtoId, nome: i.nome, quantidade: i.quantidade })),
      total: totalCarrinho(),
      dataHora: Date.now(),
    });
    // Registra em paralelo, sem esperar pelo servidor. O mesmo ID é reutilizado
    // em cliques repetidos e no reenvio da fila, impedindo pedido fantasma.
    registrarPedidoOnlineSemBloquearWhatsapp(snapshotPedido);

    // Se o pedido completo estourar o limite seguro de URL, manda só um
    // resumo pelo link (com o número do pedido e o total) e copia o texto
    // completo pra área de transferência, avisando o cliente pra colar.
    const pedidoGrande = encodeURIComponent(mensagem).length > LIMITE_CARACTERES_URL;
    const mensagemParaLink = pedidoGrande ? montarMensagemResumida(dadosCliente, numeroPedido) : mensagem;

    const numero = state.menu.restaurante.whatsapp.replace(/\D/g, "");
    const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensagemParaLink)}`;

    if (pedidoGrande) {
      copiarTextoPedido(mensagem);
    }

    if (abrirWhatsapp(url)) {
      // A sacola só é esvaziada depois que o cliente fechar o modal de
      // confirmação abaixo — o WhatsApp já abriu, mas o pedido só "sai"
      // da sacola quando o cliente confirmar que viu o aviso de que ainda
      // precisa tocar em "Enviar" lá dentro.
      esconderAvisoPopupBloqueado();
      abrirModalPedidoEnviado();
    } else {
      // Pop-up bloqueado pelo navegador (comum no Safari/iPhone e em
      // alguns Androids): mantém o pedido na sacola e mostra um link real
      // para o cliente tocar. Um clique direto em <a> não é bloqueado.
      mostrarAvisoPopupBloqueado(url, numeroPedido);
    }

    // Destrava o botão nos dois casos: se deu certo, a sacola já esvaziou
    // e um novo clique não faz nada; se foi bloqueado, o cliente precisa
    // poder tentar de novo (ex: depois de liberar o pop-up no navegador).
    destravarBotaoFinalizar();
  }

  function abrirWhatsapp(url) {
    // Sem uma espera por servidor, esta chamada continua dentro do toque do
    // usuário. Em celulares usamos a própria aba, comportamento mais confiável
    // no Safari/iPhone e nos navegadores internos do Instagram/WhatsApp.
    try {
      const ehCelular = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (ehCelular) {
        window.location.href = url;
        return true;
      }
      const novaJanela = window.open(url, "_blank", "noopener,noreferrer");
      return Boolean(novaJanela);
    } catch (e) {
      return false;
    }
  }

  function mostrarAvisoPopupBloqueado(url, numeroPedido) {
    const banner = $("#whatsapp-blocked-banner");
    const link = $("#whatsapp-blocked-link");
    const texto = $("#whatsapp-blocked-texto");
    if (link) link.href = url;
    if (texto) {
      texto.textContent = numeroPedido
        ? `📵 Seu navegador bloqueou a abertura automática do WhatsApp. (Pedido #${numeroPedido})`
        : "📵 Seu navegador bloqueou a abertura automática do WhatsApp.";
    }
    if (banner) banner.classList.remove("hidden");
    mostrarToast("Não conseguimos abrir o WhatsApp automaticamente. Toque no link acima ou copie seu pedido para enviar manualmente.");
  }

  function esconderAvisoPopupBloqueado() {
    const banner = $("#whatsapp-blocked-banner");
    if (banner) banner.classList.add("hidden");
  }

  let avisoWhatsappTimeoutId = null;

  function mostrarAvisoConfirmarWhatsapp(numeroPedido, pedidoGrande) {
    const banner = $("#whatsapp-warning-banner");
    const texto = $("#whatsapp-warning-texto");
    if (texto) {
      const base = numeroPedido
        ? `⚠️ Confirme o envio no WhatsApp para finalizar seu pedido #${numeroPedido}!`
        : "⚠️ Confirme o envio no WhatsApp para finalizar seu pedido!";
      texto.textContent = pedidoGrande
        ? `${base} Não esqueça de colar (Ctrl+V) os itens antes de enviar.`
        : base;
    }
    if (banner) banner.classList.remove("hidden");
    if (avisoWhatsappTimeoutId) clearTimeout(avisoWhatsappTimeoutId);
    // Deixa o aviso visível acima do botão por um tempo antes de fechar a sacola.
    avisoWhatsappTimeoutId = setTimeout(() => {
      fecharCarrinho();
      esconderAvisoConfirmarWhatsapp();
    }, 4000);
  }

  function esconderAvisoConfirmarWhatsapp() {
    const banner = $("#whatsapp-warning-banner");
    if (banner) banner.classList.add("hidden");
    if (avisoWhatsappTimeoutId) {
      clearTimeout(avisoWhatsappTimeoutId);
      avisoWhatsappTimeoutId = null;
    }
  }

  /* =====================================================================
     10. PWA — REGISTRO DO SERVICE WORKER
     ===================================================================== */
  function registrarServiceWorker() {
    // Service Worker (necessário para o modo offline/PWA) só funciona em
    // páginas servidas por http(s) — não funciona com o arquivo aberto
    // direto via duplo clique. Isso não afeta o funcionamento do cardápio
    // e do envio do pedido, só o recurso de "abrir sem internet".
    if (location.protocol === "file:") return;
    if (!("serviceWorker" in navigator)) return;

    // Se, no momento em que essa aba carregou, JÁ existia um Service Worker
    // controlando a página, então qualquer "controllerchange" que acontecer
    // depois disso é uma atualização de verdade (uma versão nova assumiu no
    // lugar da antiga). Se não existia controlador nenhum ainda, é só a
    // primeira instalação do PWA nesse aparelho — não é "atualização".
    const jaTinhaControlador = !!navigator.serviceWorker.controller;
    let atualizacaoTratada = false;

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Falha ao registrar o Service Worker:", err);
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!jaTinhaControlador || atualizacaoTratada) return;
      atualizacaoTratada = true;
      aplicarOuAvisarNovaVersao();
    });

    window.addEventListener("online", () => {
      mostrarOfflineBanner(false);
      void sincronizarPedidosPendentes();
    });
    window.addEventListener("offline", () => mostrarOfflineBanner(true));
  }

  // É seguro recarregar sozinho? Só quando não há risco de perder nada que
  // o cliente esteja fazendo: sacola vazia e nenhum modal/overlay aberto.
  function podeAtualizarAutomaticamente() {
    const algumOverlayAberto = ["#product-overlay", "#cart-overlay", "#order-modal-overlay"]
      .some((sel) => {
        const el = $(sel);
        return el && !el.classList.contains("hidden");
      });
    return state.cart.length === 0 && !algumOverlayAberto;
  }

  function aplicarOuAvisarNovaVersao() {
    if (podeAtualizarAutomaticamente()) {
      window.location.reload();
      return;
    }
    mostrarAvisoNovaVersao();
  }

  // Aviso discreto (não bloqueia nada, não fecha nada) com um botão pra
  // atualizar quando o cliente quiser/puder. Fica visível até ser tocado.
  function mostrarAvisoNovaVersao() {
    if ($("#toast-nova-versao")) return; // já está mostrando
    const toast = document.createElement("div");
    toast.id = "toast-nova-versao";
    toast.className = "toast toast--update";
    toast.innerHTML = `
      <span>Uma nova versão do app está disponível.</span>
      <button type="button" id="btn-atualizar-agora">Atualizar</button>
    `;
    document.body.appendChild(toast);
    $("#btn-atualizar-agora", toast).addEventListener("click", () => window.location.reload());
  }

  /* =====================================================================
     11. INICIALIZAÇÃO
     ===================================================================== */
  function configurarEventosGlobais() {
    $("#busca-input").addEventListener("input", (e) => {
      state.termoBusca = e.target.value;
      renderProdutos();
      // Enquanto o cliente está buscando algo específico, escondemos os
      // Destaques pra não competir com o resultado da busca.
      if (state.termoBusca.trim()) {
        $("#destaques-section").classList.add("hidden");
      } else {
        renderDestaques();
      }
    });

    $("#product-close").addEventListener("click", fecharModalProduto);
    $("#product-overlay").addEventListener("click", (e) => {
      if (e.target.id === "product-overlay") fecharModalProduto();
    });
    $("#add-to-cart-btn").addEventListener("click", adicionarAoCarrinhoDoModal);

    $("#cart-bar-btn").addEventListener("click", abrirCarrinho);
    $("#cart-close").addEventListener("click", fecharCarrinho);
    $("#cart-overlay").addEventListener("click", (e) => {
      if (e.target.id === "cart-overlay") fecharCarrinho();
    });

    $("#finalizar-btn").addEventListener("click", finalizarPedido);

    $("#btn-aplicar-cupom")?.addEventListener("click", aplicarCupomDoInput);
    $("#input-cupom")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        aplicarCupomDoInput();
      }
    });

    const checkboxConfirmarEnvio = $("#checkbox-confirmar-envio");
    if (checkboxConfirmarEnvio) {
      checkboxConfirmarEnvio.addEventListener("change", atualizarEstadoBotaoFinalizar);
    }
    // Estado inicial: checkbox começa desmarcado, então o botão começa
    // travado e a dica de "marque a caixa" começa visível.
    atualizarEstadoBotaoFinalizar();

    const orderModalEntendi = $("#order-modal-entendi");
    if (orderModalEntendi) {
      orderModalEntendi.addEventListener("click", fecharModalPedidoEnviado);
    }
    const orderModalClose = $("#order-modal-close");
    if (orderModalClose) {
      orderModalClose.addEventListener("click", fecharModalPedidoEnviado);
    }
    const orderModalOverlay = $("#order-modal-overlay");
    if (orderModalOverlay) {
      orderModalOverlay.addEventListener("click", (e) => {
        if (e.target.id === "order-modal-overlay") fecharModalPedidoEnviado();
      });
    }

    const whatsappWarningClose = $("#whatsapp-warning-close");
    if (whatsappWarningClose) {
      whatsappWarningClose.addEventListener("click", esconderAvisoConfirmarWhatsapp);
    }

    const whatsappWarningCopy = $("#whatsapp-warning-copy");
    if (whatsappWarningCopy) {
      whatsappWarningCopy.addEventListener("click", () => copiarTextoPedido(ultimoPedidoTextoCompleto));
    }

    const whatsappBlockedCopy = $("#whatsapp-blocked-copy");
    if (whatsappBlockedCopy) {
      whatsappBlockedCopy.addEventListener("click", () => copiarTextoPedido(ultimoPedidoTextoCompleto));
    }

    const whatsappBlockedLink = $("#whatsapp-blocked-link");
    if (whatsappBlockedLink) {
      whatsappBlockedLink.addEventListener("click", () => {
        // Só agora o pedido realmente chegou até o WhatsApp, então
        // mostramos o modal de confirmação (a sacola só esvazia quando
        // o cliente fechar esse modal — mesmo fluxo do envio automático).
        esconderAvisoPopupBloqueado();
        abrirModalPedidoEnviado();
      });
    }

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("#product-overlay").classList.contains("hidden")) fecharModalProduto();
      if (!$("#cart-overlay").classList.contains("hidden")) fecharCarrinho();
      if (!$("#order-modal-overlay").classList.contains("hidden")) fecharModalPedidoEnviado();
    });
  }

  async function init() {
    try {
      state.menu = await carregarMenu();
    } catch (erro) {
      $("#loading-screen").innerHTML = `
        <p style="color:var(--text-dim); text-align:center; padding:0 24px;">
          Não foi possível carregar o cardápio. Verifique sua conexão e tente novamente.
        </p>`;
      console.error(erro);
      return;
    }

    state.cart = carregarCartSalvo();
    state.categoriaAtiva = state.menu.categorias[0]?.id || null;

    renderCabecalho();
    renderCategoriaNav();
    renderDestaques();
    renderProdutos();
    renderCartBar();
    observarSecoes();

    ajustarOffsetHeader();
    window.addEventListener("resize", debounce(ajustarOffsetHeader, 150));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(ajustarOffsetHeader);
    }

    configurarStepperModal();
    configurarEntregaRetirada();
    configurarFormaPagamento();
    configurarEventosGlobais();
    popularSelectBairro();
    preencherDadosClienteSalvos();
    registrarServiceWorker();
    atualizarPix();
    iniciarAtualizacaoAutomatica();
    // Reenvia silenciosamente pedidos que ficaram na fila por queda da API.
    // O backend usa o ID original, portanto essa retomada não duplica pedido.
    void sincronizarPedidosPendentes();

    $("#loading-screen").classList.add("hidden");
    $("#app").classList.remove("hidden");
  }

  document.addEventListener("DOMContentLoaded", init);
})();

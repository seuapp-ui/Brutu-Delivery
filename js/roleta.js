/**
 * Roleta da Sorte — Brutu's Delivery
 * Depende de window.SITE_CONFIG e opcionalmente do backend em /api/roleta/*
 */
(() => {
  "use strict";

  const API_BASE = () => {
    const b = (window.SITE_CONFIG && window.SITE_CONFIG.apiBase) || "";
    return String(b).replace(/\/$/, "");
  };

  const state = {
    config: null,
    cliente: null,
    telefone: "",
    girando: false,
    rotacaoAtual: 0,
    erroAcesso: "",
  };

  function $(sel, ctx = document) {
    return ctx.querySelector(sel);
  }

  function apiUrl(path) {
    return API_BASE() + path;
  }

  const ROLETA_KEY_STORAGE = "brutus-roleta-chave:v1";

  function chaveDoAparelho() {
    try {
      let chave = localStorage.getItem(ROLETA_KEY_STORAGE) || "";
      if (chave.length >= 32) return chave;
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      chave = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(ROLETA_KEY_STORAGE, chave);
      return chave;
    } catch (e) {
      return "";
    }
  }

  async function api(path, opts = {}) {
    const chave = chaveDoAparelho();
    const res = await fetch(apiUrl(path), {
      headers: {
        "Content-Type": "application/json",
        ...(chave ? { "X-Roleta-Key": chave } : {}),
        ...(opts.headers || {}),
      },
      ...opts,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.erro) || "Erro na roleta");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function telefoneSalvo() {
    try {
      const raw = localStorage.getItem("brutus-cliente:v1");
      if (!raw) return "";
      const d = JSON.parse(raw);
      return (d.telefone || "").replace(/\D/g, "");
    } catch (e) {
      return "";
    }
  }

  function salvarTelefoneLocal(tel) {
    state.telefone = String(tel || "").replace(/\D/g, "");
    try {
      localStorage.setItem("brutus-roleta-tel", state.telefone);
    } catch (e) {}
  }

  function carregarTelefoneLocal() {
    try {
      return localStorage.getItem("brutus-roleta-tel") || telefoneSalvo() || "";
    } catch (e) {
      return telefoneSalvo() || "";
    }
  }

  /* ---------- Sons (Web Audio, sem arquivos externos) ---------- */
  function playSpinSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      let t = ctx.currentTime;
      for (let i = 0; i < 18; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "square";
        o.frequency.value = 200 + i * 40;
        g.gain.value = 0.03;
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.04);
        t += 0.07 + i * 0.01;
      }
      setTimeout(() => ctx.close(), 2500);
    } catch (e) {}
  }

  function playWinSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523, 659, 784, 1046];
      notes.forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = freq;
        o.type = "sine";
        g.gain.value = 0.08;
        o.connect(g);
        g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.12;
        o.start(t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.stop(t + 0.35);
      });
      setTimeout(() => ctx.close(), 1500);
    } catch (e) {}
  }

  function confetes() {
    const layer = $("#roleta-confetti");
    if (!layer) return;
    layer.innerHTML = "";
    const cores = ["#ff5a1f", "#ffb100", "#37c973", "#5b8def", "#f6efe6"];
    for (let i = 0; i < 48; i++) {
      const p = document.createElement("span");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "%";
      p.style.background = cores[i % cores.length];
      p.style.animationDelay = Math.random() * 0.4 + "s";
      p.style.animationDuration = 1.2 + Math.random() * 1.2 + "s";
      layer.appendChild(p);
    }
    setTimeout(() => {
      layer.innerHTML = "";
    }, 2800);
  }

  /* ---------- UI ---------- */
  function montarRoda(premios) {
    const roda = $("#roleta-roda");
    if (!roda || !premios.length) return;
    const n = premios.length;
    const step = 360 / n;
    const grad = premios
      .map((p, i) => {
        const a0 = i * step;
        const a1 = (i + 1) * step;
        return `${p.cor || "#333"} ${a0}deg ${a1}deg`;
      })
      .join(", ");
    roda.style.background = `conic-gradient(from -90deg, ${grad})`;

    const labels = $("#roleta-labels");
    if (labels) {
      labels.innerHTML = premios
        .map((p, i) => {
          const mid = -90 + i * step + step / 2;
          return `<div class="roleta-label" style="--ang:${mid}deg"><span>${p.icone}<br>${p.nome}</span></div>`;
        })
        .join("");
    }
  }

  function atualizarGirosUI() {
    const n = state.cliente ? state.cliente.giros || 0 : 0;
    const el = $("#roleta-giros-count");
    if (el) el.textContent = String(n);
    const btn = $("#roleta-btn-girar");
    if (btn) {
      btn.disabled = state.girando || n < 1 || !state.telefone;
      btn.textContent = n < 1 ? "Sem giros" : state.girando ? "Girando…" : "Girar!";
    }
  }

  function renderPremiosLista() {
    const lista = $("#roleta-meus-premios");
    if (!lista) return;
    if (state.erroAcesso) {
      lista.innerHTML = "";
      const aviso = document.createElement("p");
      aviso.className = "roleta-vazio";
      aviso.textContent = state.erroAcesso;
      lista.appendChild(aviso);
      return;
    }
    const disponiveis = (state.cliente && state.cliente.premiosDisponiveis) || [];
    if (!disponiveis.length) {
      lista.innerHTML = '<p class="roleta-vazio">Nenhum prêmio disponível no momento.</p>';
      return;
    }
    lista.innerHTML = disponiveis
      .map((p) => {
        const exp = p.expiraEm
          ? new Date(p.expiraEm).toLocaleDateString("pt-BR")
          : "—";
        return `<div class="roleta-premio-card">
          <span class="rp-icone">${p.icone || "🎁"}</span>
          <div class="rp-info">
            <strong>${p.nome}</strong>
            <span>Válido até ${exp}</span>
          </div>
        </div>`;
      })
      .join("");
  }

  async function carregarCliente(tel) {
    salvarTelefoneLocal(tel);
    if (!tel || tel.length < 10) {
      state.cliente = null;
      atualizarGirosUI();
      renderPremiosLista();
      return;
    }
    try {
      state.cliente = await api(`/api/roleta/cliente/${encodeURIComponent(tel)}`);
      state.erroAcesso = "";
    } catch (e) {
      state.cliente = { giros: 0, premiosDisponiveis: [], premios: [] };
      state.erroAcesso = e.status === 403
        ? "Este aparelho será liberado para a roleta depois que um pedido feito nele for marcado como entregue."
        : "Não foi possível consultar seus giros agora.";
    }
    atualizarGirosUI();
    renderPremiosLista();
    // Expõe para o checkout
    window.BRUTUS_ROLETA = window.BRUTUS_ROLETA || {};
    window.BRUTUS_ROLETA.getPremiosDisponiveis = () =>
      (state.cliente && state.cliente.premiosDisponiveis) || [];
    window.BRUTUS_ROLETA.getTelefone = () => state.telefone;
    window.BRUTUS_ROLETA.refresh = () => carregarCliente(state.telefone);
  }

  function abrirModal() {
    const overlay = $("#roleta-overlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    const tel = carregarTelefoneLocal();
    const input = $("#roleta-tel-input");
    if (input && tel) input.value = tel;
    if (tel && tel.length >= 10) carregarCliente(tel);
  }

  function fecharModal() {
    const overlay = $("#roleta-overlay");
    if (!overlay) return;
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
    $("#roleta-win-modal")?.classList.add("hidden");
  }

  function mostrarVitoria(premio) {
    const modal = $("#roleta-win-modal");
    if (!modal) return;
    $("#roleta-win-icone").textContent = premio.icone || "🎁";
    $("#roleta-win-nome").textContent = premio.nome || "Prêmio";
    modal.classList.remove("hidden");
    playWinSound();
    confetes();
  }

  async function girar() {
    if (state.girando) return;
    const tel =
      ($("#roleta-tel-input")?.value || "").replace(/\D/g, "") || state.telefone;
    if (!tel || tel.length < 10) {
      alert("Informe seu WhatsApp (com DDD) para girar.");
      return;
    }
    salvarTelefoneLocal(tel);

    state.girando = true;
    atualizarGirosUI();
    playSpinSound();

    try {
      const result = await api("/api/roleta/girar", {
        method: "POST",
        body: JSON.stringify({ telefone: tel }),
      });

      const premios = (state.config && state.config.premios) || [];
      const n = premios.length || 4;
      const idx = typeof result.segmentoIndex === "number" ? result.segmentoIndex : 0;
      const step = 360 / n;
      // Ponteiro no topo; centro do segmento idx
      const alvoCentro = idx * step + step / 2;
      const voltas = 5 + Math.floor(Math.random() * 3);
      const destino = voltas * 360 + (360 - alvoCentro);
      state.rotacaoAtual = (state.rotacaoAtual % 360) + destino;

      const roda = $("#roleta-roda");
      if (roda) {
        roda.style.transition = "transform 4.2s cubic-bezier(0.12, 0.75, 0.12, 1)";
        roda.style.transform = `rotate(${state.rotacaoAtual}deg)`;
      }

      setTimeout(async () => {
        state.girando = false;
        await carregarCliente(tel);
        mostrarVitoria(result.premio);
        atualizarGirosUI();
      }, 4300);
    } catch (e) {
      state.girando = false;
      atualizarGirosUI();
      alert(e.message || "Não foi possível girar.");
    }
  }

  async function initRoleta() {
    // Carrega config (fallback local se API offline)
    try {
      state.config = await api("/api/roleta/config");
    } catch (e) {
      state.config = {
        ativo: true,
        premios: [
          { id: "desc5", nome: "5% de desconto", icone: "🏷️", tipo: "desconto_percentual", valor: 5, probabilidade: 45, cor: "#ff5a1f" },
          { id: "batata", nome: "Batata Frita 200 g grátis", icone: "🍟", tipo: "produto_gratis", produtoId: "p001", probabilidade: 25, cor: "#ffb100" },
          { id: "refri", nome: "Refrigerante lata grátis", icone: "🥤", tipo: "produto_gratis", produtoId: "b001", probabilidade: 20, cor: "#37c973" },
          { id: "frupic", nome: "Suco Frupic grátis", icone: "🧃", tipo: "produto_gratis", produtoId: "b009", probabilidade: 10, cor: "#5b8def" },
        ],
        validadeDias: 7,
      };
    }

    // Se o lojista desativou a roleta no painel, esconde o botão flutuante e o modal
    if (state.config && state.config.ativo === false) {
      $("#roleta-open-btn")?.classList.add("hidden");
      $("#roleta-overlay")?.classList.add("hidden");
      window.BRUTUS_ROLETA = {
        config: () => state.config,
        getChave: chaveDoAparelho,
      };
      return;
    }

    montarRoda(state.config.premios);

    $("#roleta-open-btn")?.addEventListener("click", abrirModal);
    $("#roleta-close")?.addEventListener("click", fecharModal);
    $("#roleta-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "roleta-overlay") fecharModal();
    });
    $("#roleta-btn-girar")?.addEventListener("click", girar);
    $("#roleta-btn-tel")?.addEventListener("click", () => {
      const tel = ($("#roleta-tel-input")?.value || "").replace(/\D/g, "");
      carregarCliente(tel);
    });
    $("#roleta-win-depois")?.addEventListener("click", () => {
      $("#roleta-win-modal")?.classList.add("hidden");
    });

    window.BRUTUS_ROLETA = {
      open: abrirModal,
      getPremiosDisponiveis: () => (state.cliente && state.cliente.premiosDisponiveis) || [],
      getTelefone: () => state.telefone,
      getChave: chaveDoAparelho,
      refresh: () => carregarCliente(state.telefone || carregarTelefoneLocal()),
      resgatarNoServidor: async (premioId, telefone) => {
        return api("/api/roleta/resgatar", {
          method: "POST",
          body: JSON.stringify({ premioId, telefone }),
        });
      },
      config: () => state.config,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRoleta);
  } else {
    initRoleta();
  }
})();

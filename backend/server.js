/**
 * Brutu's Delivery — API leve (Express + JSON em disco)
 *
 * Uso:
 *   cd backend && npm install && npm start
 *
 * Sobe em http://localhost:3000 e também serve o site estático da pasta pai.
 *
 * Endpoints principais:
 *   POST /api/auth/login          → { token }
 *   GET  /api/menu                → cardápio público
 *   PUT  /api/menu                → salva menu (auth)
 *   GET  /api/pedidos             → lista pedidos (auth)
 *   POST /api/pedidos             → cria pedido (público)
 *   PATCH /api/pedidos/:id/status → muda status (auth)
 *   POST /api/cupons/usar         → incrementa uso de cupom (público, ao finalizar)
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(__dirname, "data");
const PEDIDOS_FILE = path.join(DATA_DIR, "pedidos.json");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const MENU_FILE = path.join(ROOT, "data", "menu.json");
const MENU_DATA_JS = path.join(ROOT, "data", "menu-data.js");
const CLIENTES_FILE = path.join(DATA_DIR, "clientes.json");
const ROLETA_CONFIG_FILE = path.join(DATA_DIR, "roleta-config.json");

const app = express();
app.use(cors());
app.use(express.json({ limit: "8mb" }));

/* ---------- helpers de arquivo ---------- */
function lerJson(arquivo, fallback) {
  try {
    if (!fs.existsSync(arquivo)) return fallback;
    return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch {
    return fallback;
  }
}

function escreverJson(arquivo, dados) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2) + "\n", "utf8");
}

function lerAuth() {
  return lerJson(AUTH_FILE, {
    usuario: "admin",
    senha: "5625",
    tokenSecreto: "brutus-painel-token-mude-em-producao",
  });
}

function tokenValido(req) {
  const auth = lerAuth();
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token && token === auth.tokenSecreto;
}

function exigirAuth(req, res, next) {
  if (!tokenValido(req)) {
    return res.status(401).json({ erro: "Não autenticado. Faça login no painel." });
  }
  next();
}

function regenerarMenuDataJs(menu) {
  const js =
    "// Gerado automaticamente pelo servidor a partir de data/menu.json\n" +
    "window.MENU_DATA = " +
    JSON.stringify(menu, null, 2) +
    ";\n";
  fs.writeFileSync(MENU_DATA_JS, js, "utf8");
}

function idCurto() {
  return Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 4).toUpperCase();
}

/* ---------- AUTH ---------- */
app.post("/api/auth/login", (req, res) => {
  const { usuario, senha } = req.body || {};
  const auth = lerAuth();
  if (String(usuario) === auth.usuario && String(senha) === auth.senha) {
    return res.json({
      ok: true,
      token: auth.tokenSecreto,
      usuario: auth.usuario,
    });
  }
  return res.status(401).json({ erro: "Usuário ou senha incorretos." });
});

app.get("/api/auth/me", exigirAuth, (req, res) => {
  const auth = lerAuth();
  res.json({ ok: true, usuario: auth.usuario });
});

app.put("/api/auth/senha", exigirAuth, (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha || String(senha).length < 4) {
    return res.status(400).json({ erro: "Usuário e senha (mín. 4 caracteres) são obrigatórios." });
  }
  const auth = lerAuth();
  auth.usuario = String(usuario).trim();
  auth.senha = String(senha);
  escreverJson(AUTH_FILE, auth);
  res.json({ ok: true, mensagem: "Credenciais atualizadas." });
});

/* ---------- MENU ---------- */
app.get("/api/menu", (req, res) => {
  const menu = lerJson(MENU_FILE, null);
  if (!menu) return res.status(404).json({ erro: "menu.json não encontrado" });
  res.json(menu);
});

app.put("/api/menu", exigirAuth, (req, res) => {
  const menu = req.body;
  if (!menu || typeof menu !== "object" || !menu.restaurante || !Array.isArray(menu.produtos)) {
    return res.status(400).json({ erro: "JSON de menu inválido." });
  }
  escreverJson(MENU_FILE, menu);
  // espelho na raiz (alguns setups usam menu.json na raiz)
  try {
    escreverJson(path.join(ROOT, "menu.json"), menu);
  } catch (e) {}
  try {
    regenerarMenuDataJs(menu);
  } catch (e) {
    console.warn("Não foi possível regenerar menu-data.js:", e.message);
  }
  res.json({ ok: true, mensagem: "Cardápio salvo no servidor." });
});

/* ---------- PEDIDOS ---------- */
app.get("/api/pedidos", exigirAuth, (req, res) => {
  const pedidos = lerJson(PEDIDOS_FILE, []);
  const ordenados = [...pedidos].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  res.json(ordenados);
});

app.get("/api/pedidos/resumo", exigirAuth, (req, res) => {
  const pedidos = lerJson(PEDIDOS_FILE, []);
  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const hoje = pedidos.filter((p) => (p.ts || 0) >= inicioHoje && p.status !== "cancelado");
  const andamento = pedidos.filter((p) =>
    ["recebido", "preparando", "saiu_entrega"].includes(p.status)
  );
  const faturamento = hoje.reduce((s, p) => s + (Number(p.total) || 0), 0);
  const ticket = hoje.length ? faturamento / hoje.length : 0;
  const contagem = {};
  hoje.forEach((p) => {
    (p.itens || []).forEach((i) => {
      const n = i.nome || "Item";
      contagem[n] = (contagem[n] || 0) + (Number(i.quantidade) || 1);
    });
  });
  const maisVendido = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0];
  res.json({
    pedidosHoje: hoje.length,
    faturamentoHoje: faturamento,
    ticketMedio: ticket,
    emAndamento: andamento.length,
    produtoMaisVendido: maisVendido ? maisVendido[0] : null,
  });
});

app.post("/api/pedidos", (req, res) => {
  const body = req.body || {};
  if (!body.itens || !Array.isArray(body.itens) || !body.itens.length) {
    return res.status(400).json({ erro: "Pedido sem itens." });
  }
  const pedidos = lerJson(PEDIDOS_FILE, []);
  const pedido = {
    id: "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    numero: body.numero || idCurto(),
    ts: Date.now(),
    status: "recebido",
    total: Number(body.total) || 0,
    subtotal: Number(body.subtotal) || 0,
    taxa: Number(body.taxa) || 0,
    desconto: Number(body.desconto) || 0,
    cupom: body.cupom || null,
    cliente: body.cliente || "",
    telefone: body.telefone || "",
    tipoEntrega: body.tipoEntrega || "entrega",
    formaPagamento: body.formaPagamento || "",
    endereco: body.endereco || "",
    bairro: body.bairro || "",
    observacao: body.observacao || "",
    itens: body.itens,
  };
  pedidos.unshift(pedido);
  escreverJson(PEDIDOS_FILE, pedidos.slice(0, 2000));

  // Incrementa uso do cupom no menu, se houver
  if (pedido.cupom) {
    try {
      const menu = lerJson(MENU_FILE, null);
      if (menu && Array.isArray(menu.cupons)) {
        const c = menu.cupons.find(
          (x) => String(x.codigo || "").toUpperCase() === String(pedido.cupom).toUpperCase()
        );
        if (c) {
          c.usos = (Number(c.usos) || 0) + 1;
          escreverJson(MENU_FILE, menu);
          regenerarMenuDataJs(menu);
        }
      }
    } catch (e) {
      console.warn("Falha ao incrementar cupom:", e.message);
    }
  }

  res.status(201).json(pedido);
});

app.patch("/api/pedidos/:id/status", exigirAuth, (req, res) => {
  const status = req.body?.status;
  const validos = ["recebido", "preparando", "saiu_entrega", "entregue", "cancelado"];
  if (!validos.includes(status)) {
    return res.status(400).json({ erro: "Status inválido.", validos });
  }
  const pedidos = lerJson(PEDIDOS_FILE, []);
  const idx = pedidos.findIndex((p) => p.id === req.params.id || p.numero === req.params.id);
  if (idx === -1) return res.status(404).json({ erro: "Pedido não encontrado." });
  const statusAnterior = pedidos[idx].status;
  pedidos[idx].status = status;
  pedidos[idx].atualizadoEm = Date.now();
  escreverJson(PEDIDOS_FILE, pedidos);
  // Ao marcar como entregue pela primeira vez, concede 1 giro na roleta
  if (status === "entregue" && statusAnterior !== "entregue") {
    try {
      concederGiroPorPedidoEntregue(pedidos[idx]);
    } catch (e) {
      console.warn("Falha ao conceder giro:", e.message);
    }
  }
  res.json(pedidos[idx]);
});

app.post("/api/cupons/usar", (req, res) => {
  const codigo = String(req.body?.codigo || "").trim().toUpperCase();
  if (!codigo) return res.status(400).json({ erro: "Código obrigatório." });
  const menu = lerJson(MENU_FILE, null);
  if (!menu || !Array.isArray(menu.cupons)) {
    return res.status(404).json({ erro: "Cupom não encontrado." });
  }
  const c = menu.cupons.find((x) => String(x.codigo || "").toUpperCase() === codigo);
  if (!c || c.ativo === false) return res.status(404).json({ erro: "Cupom inválido." });
  if (c.usoMaximo > 0 && (c.usos || 0) >= c.usoMaximo) {
    return res.status(409).json({ erro: "Cupom esgotado." });
  }
  c.usos = (Number(c.usos) || 0) + 1;
  escreverJson(MENU_FILE, menu);
  try {
    regenerarMenuDataJs(menu);
  } catch (e) {}
  res.json({ ok: true, usos: c.usos });
});


/* ---------- ROLETA DA SORTE ---------- */
function normalizarTelefone(tel) {
  return String(tel || "").replace(/\D/g, "");
}

function lerClientes() {
  return lerJson(CLIENTES_FILE, {});
}

function salvarClientes(dados) {
  escreverJson(CLIENTES_FILE, dados);
}

function lerRoletaConfig() {
  return lerJson(ROLETA_CONFIG_FILE, { premios: [], validadeDias: 7 });
}

function clientePadrao(telefone) {
  return {
    telefone,
    giros: 0,
    totalPedidos: 0,
    premios: [],
    historicoGiros: [],
    criadoEm: Date.now(),
  };
}

function obterCliente(telefone) {
  const tel = normalizarTelefone(telefone);
  if (!tel || tel.length < 10) return null;
  const db = lerClientes();
  if (!db[tel]) {
    db[tel] = clientePadrao(tel);
    salvarClientes(db);
  }
  return { tel, cliente: db[tel], db };
}

function limparPremiosExpirados(cliente) {
  const agora = Date.now();
  let mudou = false;
  (cliente.premios || []).forEach((p) => {
    if (p.status === "disponivel" && p.expiraEm && p.expiraEm < agora) {
      p.status = "expirado";
      mudou = true;
    }
  });
  return mudou;
}

function sortearPremio(premios) {
  const total = premios.reduce((s, p) => s + (Number(p.probabilidade) || 0), 0);
  let r = Math.random() * total;
  for (const p of premios) {
    r -= Number(p.probabilidade) || 0;
    if (r <= 0) return p;
  }
  return premios[premios.length - 1];
}

app.get("/api/roleta/config", (req, res) => {
  res.json(lerRoletaConfig());
});

app.get("/api/roleta/cliente/:telefone", (req, res) => {
  const info = obterCliente(req.params.telefone);
  if (!info) return res.status(400).json({ erro: "Telefone inválido." });
  const { cliente, db, tel } = info;
  if (limparPremiosExpirados(cliente)) {
    db[tel] = cliente;
    salvarClientes(db);
  }
  const disponiveis = (cliente.premios || []).filter((p) => p.status === "disponivel");
  res.json({
    telefone: tel,
    giros: cliente.giros || 0,
    totalPedidos: cliente.totalPedidos || 0,
    premiosDisponiveis: disponiveis,
    premios: cliente.premios || [],
    historicoGiros: (cliente.historicoGiros || []).slice(0, 30),
  });
});

app.post("/api/roleta/girar", (req, res) => {
  const telRaw = req.body?.telefone;
  const info = obterCliente(telRaw);
  if (!info) return res.status(400).json({ erro: "Telefone inválido." });
  const { cliente, db, tel } = info;
  limparPremiosExpirados(cliente);

  if ((cliente.giros || 0) < 1) {
    return res.status(409).json({ erro: "Você não possui giros disponíveis." });
  }

  const cfg = lerRoletaConfig();
  const premiosCfg = cfg.premios || [];
  if (!premiosCfg.length) return res.status(500).json({ erro: "Roleta sem prêmios configurados." });

  const sorteado = sortearPremio(premiosCfg);
  const validadeDias = Number(cfg.validadeDias) || 7;
  const agora = Date.now();
  const premio = {
    id: "pr-" + agora.toString(36) + Math.random().toString(36).slice(2, 6),
    premioId: sorteado.id,
    nome: sorteado.nome,
    icone: sorteado.icone,
    tipo: sorteado.tipo,
    valor: sorteado.valor,
    produtoId: sorteado.produtoId || null,
    status: "disponivel",
    ganhoEm: agora,
    expiraEm: agora + validadeDias * 24 * 60 * 60 * 1000,
  };

  cliente.giros = (cliente.giros || 0) - 1;
  cliente.premios = cliente.premios || [];
  cliente.premios.unshift(premio);
  cliente.historicoGiros = cliente.historicoGiros || [];
  cliente.historicoGiros.unshift({
    ts: agora,
    premioId: sorteado.id,
    nome: sorteado.nome,
    premioClienteId: premio.id,
  });
  // limita histórico
  cliente.historicoGiros = cliente.historicoGiros.slice(0, 100);
  cliente.premios = cliente.premios.slice(0, 50);

  db[tel] = cliente;
  salvarClientes(db);

  res.json({
    ok: true,
    premio,
    girosRestantes: cliente.giros,
    segmentoIndex: premiosCfg.findIndex((p) => p.id === sorteado.id),
  });
});

app.post("/api/roleta/resgatar", (req, res) => {
  // marca prêmio como utilizado (validação server-side)
  const telRaw = req.body?.telefone;
  const premioId = req.body?.premioId;
  const info = obterCliente(telRaw);
  if (!info) return res.status(400).json({ erro: "Telefone inválido." });
  const { cliente, db, tel } = info;
  limparPremiosExpirados(cliente);
  const premio = (cliente.premios || []).find((p) => p.id === premioId);
  if (!premio) return res.status(404).json({ erro: "Prêmio não encontrado." });
  if (premio.status !== "disponivel") {
    return res.status(409).json({ erro: "Prêmio já utilizado ou expirado." });
  }
  if (premio.expiraEm && premio.expiraEm < Date.now()) {
    premio.status = "expirado";
    db[tel] = cliente;
    salvarClientes(db);
    return res.status(409).json({ erro: "Prêmio expirado." });
  }
  premio.status = "utilizado";
  premio.utilizadoEm = Date.now();
  db[tel] = cliente;
  salvarClientes(db);
  res.json({ ok: true, premio });
});

// Chamado internamente quando status do pedido vira "entregue"
function concederGiroPorPedidoEntregue(pedido) {
  const tel = normalizarTelefone(pedido.telefone);
  if (!tel || tel.length < 10) return;
  const db = lerClientes();
  if (!db[tel]) db[tel] = clientePadrao(tel);
  const c = db[tel];
  c.totalPedidos = (c.totalPedidos || 0) + 1;
  c.giros = (c.giros || 0) + 1;
  // primeira compra também garante o giro (já coberto pelo +1 acima)
  db[tel] = c;
  salvarClientes(db);
}

/* ---------- health ---------- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, versao: "1.0.0", ts: Date.now() });
});

/* ---------- estáticos (site) ---------- */
app.use(express.static(ROOT));

app.listen(PORT, () => {
  console.log(`Brutu's API + site em http://localhost:${PORT}`);
  console.log(`Painel: http://localhost:${PORT}/painel-produtos.html`);
  console.log(`Cardápio: http://localhost:${PORT}/`);
});

/**
 * Brutu's Delivery — API (Express + SQLite)
 *
 * Uso:
 *   cd backend && npm install && npm start
 *
 * Sobe em http://localhost:3000 e também serve o site estático da pasta pai.
 *
 * Persistência:
 *   - Pedidos, auth, clientes e roleta → SQLite (DATABASE_PATH/DB_PATH; local: backend/data/brutus.db)
 *   - Cardápio → data/menu.json (inalterado)
 *
 * Variáveis de ambiente opcionais:
 *   PORT, DATABASE_PATH (ou DB_PATH), ADMIN_USER, ADMIN_PASSWORD
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const store = require("./db");
const regras = require("./lib/regras-negocio");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const MENU_FILE = path.join(ROOT, "data", "menu.json");
const MENU_DATA_JS = path.join(ROOT, "data", "menu-data.js");

// Abre o SQLite na subida (migra JSON antigos se existirem)
store.abrir();
console.log(`[auth] ADMIN_PASSWORD encontrada: ${String(process.env.ADMIN_PASSWORD || "").trim().length > 0 ? "SIM" : "NÃO (usando SQLite)"}`);
console.log(`[auth] Usuário do ambiente: ${String(process.env.ADMIN_USER || "").trim() || "não definido (usa usuário do SQLite)"}`);

const app = express();

/* ---------- origens e headers de segurança ---------- */
const ORIGEM_PRODUCAO = "https://brutu-s-delivery.onrender.com";
const origensPermitidas = new Set([
  ORIGEM_PRODUCAO,
  ...String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origem) => origem.trim().replace(/\/$/, ""))
    .filter(Boolean),
]);

// Desenvolvimento local é opcional e nunca fica liberado por acidente.
if (String(process.env.ALLOW_LOCAL_ORIGINS || "").toLowerCase() === "true") {
  origensPermitidas.add("http://localhost:3000");
  origensPermitidas.add("http://127.0.0.1:3000");
}

function origemPermitida(origem) {
  if (!origem) return true; // navegação normal, curl, monitor do Render etc.
  return origensPermitidas.has(String(origem).replace(/\/$/, ""));
}

// Rejeita a origem antes de executar a rota. Assim o CORS não é apenas uma
// restrição de leitura do navegador: uma origem estranha também não causa
// efeitos colaterais em POST/PATCH/DELETE.
app.use((req, res, next) => {
  const origem = req.headers.origin;
  if (origem && !origemPermitida(origem)) {
    return res.status(403).json({ erro: "Origem não permitida." });
  }
  next();
});

app.use(cors({
  origin(origem, callback) {
    callback(null, origemPermitida(origem) ? (origem || false) : false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Roleta-Key"],
  maxAge: 86400,
}));

app.use((req, res, next) => {
  res.setHeader("X-Request-Id", crypto.randomUUID());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // Política compatível com as telas antigas, que ainda têm scripts inline.
  // O painel administrativo recebe abaixo uma política mais rígida com nonce.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
    "form-action 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; " +
    "connect-src 'self'"
  );
  next();
});
app.use(express.json({ limit: "1mb", strict: true }));

/* ---------- SSE: avisa o painel quando chega pedido novo ou muda status ---------- */
const sseClients = new Set();

function broadcastPedido(evento, dados) {
  const payload = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (e) {
      sseClients.delete(res);
    }
  }
}

/* ---------- helpers de arquivo (só menu.json) ---------- */
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

function lerMenuOficial() {
  return store.lerMenu(lerJson(MENU_FILE, null));
}

function salvarMenuOficial(menu) {
  store.salvarMenu(menu);
  // Espelhos para abrir o cardápio com dois cliques e facilitar backup.
  try { escreverJson(MENU_FILE, menu); } catch (e) { console.warn("Espelho menu.json:", e.message); }
  try { escreverJson(path.join(ROOT, "menu.json"), menu); } catch (e) {}
  try { regenerarMenuDataJs(menu); } catch (e) { console.warn("Espelho menu-data.js:", e.message); }
  return menu;
}

function lerAuth() {
  return store.lerAuth();
}

/* ---------- senha: hash scrypt (nativo Node) ---------- */
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(senha), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verificarSenha(senha, armazenada) {
  const s = String(armazenada || "");
  if (s.startsWith("scrypt$")) {
    const parts = s.split("$");
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const hashEsperado = parts[2];
    const hash = crypto.scryptSync(String(senha), salt, 64).toString("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(hashEsperado, "hex"));
    } catch {
      return false;
    }
  }
  // Senhas em texto puro não são mais aceitas.
  return false;
}

function extrairToken(req) {
  const header = req.headers.authorization || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

function tokenValido(req) {
  const token = extrairToken(req);
  if (!token) return false;
  return !!store.validarSessao(token);
}

function exigirAuth(req, res, next) {
  if (!tokenValido(req)) {
    return res.status(401).json({ erro: "Não autenticado. Faça login no painel." });
  }
  next();
}

/* Rate limit simples de login (por IP) */
const loginTentativas = new Map();
function loginRateLimit(ip) {
  const agora = Date.now();
  let rec = loginTentativas.get(ip);
  if (!rec || agora - rec.inicio > 15 * 60 * 1000) {
    rec = { inicio: agora, count: 0 };
  }
  rec.count += 1;
  loginTentativas.set(ip, rec);
  return rec.count <= 20; // máx. 20 tentativas / 15 min por IP
}

const limites = new Map();
function limitar({ janelaMs, max, chave }) {
  return (req, res, next) => {
    const agora = Date.now();
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
    const id = `${chave}:${ip}`;
    let rec = limites.get(id);
    if (!rec || agora - rec.inicio >= janelaMs) rec = { inicio: agora, n: 0 };
    rec.n += 1;
    limites.set(id, rec);
    res.setHeader("X-RateLimit-Limit", String(max));
    if (rec.n > max) {
      res.setHeader("Retry-After", String(Math.ceil((janelaMs - (agora - rec.inicio)) / 1000)));
      return res.status(429).json({ erro: "Muitas tentativas. Aguarde e tente novamente." });
    }
    next();
  };
}

setInterval(() => {
  const limite = Date.now() - 60 * 60 * 1000;
  for (const [k, v] of limites) if (v.inicio < limite) limites.delete(k);
}, 15 * 60 * 1000).unref();

function regenerarMenuDataJs(menu) {
  const js =
    "// Gerado automaticamente pelo servidor a partir de data/menu.json\n" +
    "window.MENU_DATA = " +
    JSON.stringify(menu, null, 2) +
    ";\n";
  fs.writeFileSync(MENU_DATA_JS, js, "utf8");
}

/**
 * PIX secreto via variáveis de ambiente no Render (não vai para o Git):
 *   PIX_CHAVE, PIX_TIPO, PIX_TITULAR, PIX_CIDADE
 * Se PIX_CHAVE estiver definida, ela SEMPRE sobrescreve o menu.json
 * e o painel não consegue gravar outra chave.
 */
function pixDoAmbiente() {
  const chave = String(process.env.PIX_CHAVE || "").trim();
  if (!chave) return null;
  return {
    chave,
    tipo: String(process.env.PIX_TIPO || "cnpj").trim().toLowerCase() || "cnpj",
    titular: String(process.env.PIX_TITULAR || "").trim(),
    cidade: String(process.env.PIX_CIDADE || "MORRO AGUDO").trim() || "MORRO AGUDO",
    protegido: true,
  };
}

function aplicarPixSeguro(menu) {
  if (!menu || typeof menu !== "object") return menu;
  const envPix = pixDoAmbiente();
  if (!envPix) return menu;
  menu.restaurante = menu.restaurante || {};
  menu.restaurante.pix = envPix;
  return menu;
}

function idCurto() {
  return Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 4).toUpperCase();
}

/* ---------- AUTH ---------- */
app.post("/api/auth/login", (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local";
  if (!loginRateLimit(String(ip).split(",")[0].trim())) {
    return res.status(429).json({ erro: "Muitas tentativas. Aguarde alguns minutos." });
  }

  const { usuario, senha } = req.body || {};
  const auth = lerAuth();

  // Se ADMIN_PASSWORD existir no Render, ela tem prioridade total sobre a senha do SQLite.
  // ADMIN_USER é opcional; sem ele, usa o usuário salvo no banco (normalmente "admin").
  const senhaAmbiente = String(process.env.ADMIN_PASSWORD || "").trim();
  const usuarioAmbiente = String(process.env.ADMIN_USER || auth.usuario || "admin").trim();
  const usuarioRecebido = String(usuario || "").trim();
  const senhaRecebida = String(senha || "").trim();
  const usandoSenhaAmbiente = senhaAmbiente.length > 0;

  let loginOk = false;
  let usuarioLogado = auth.usuario;

  if (usandoSenhaAmbiente) {
    loginOk =
      usuarioRecebido === usuarioAmbiente &&
      senhaRecebida === senhaAmbiente;

    // Diagnóstico seguro: não registra a senha, apenas informa o motivo da recusa.
    if (!loginOk) {
      console.warn(`[auth] Login recusado via Environment | usuario=${usuarioRecebido || "(vazio)"} | usuarioOk=${usuarioRecebido === usuarioAmbiente ? "SIM" : "NÃO"} | tamanhoSenhaRecebida=${senhaRecebida.length} | tamanhoSenhaEsperada=${senhaAmbiente.length} | senhaOk=${senhaRecebida === senhaAmbiente ? "SIM" : "NÃO"}`);
    }
    usuarioLogado = usuarioAmbiente;
  } else {
    loginOk =
      String(usuario) === auth.usuario &&
      verificarSenha(senha, auth.senha);

    // Migra senha legada (texto puro) para hash somente quando o login usa o SQLite.
    if (loginOk && !String(auth.senha || "").startsWith("scrypt$")) {
      auth.senha = hashSenha(senha);
      store.salvarAuth(auth);
    }
  }

  if (!loginOk) {
    console.warn(`[auth] LOGIN RECUSADO | metodo=${usandoSenhaAmbiente ? "ENV" : "SQLITE"} | usuario=${usuarioRecebido || "(vazio)"}`);
    return res.status(401).json({ erro: "Usuário ou senha incorretos." });
  }

  console.log(`[auth] LOGIN OK | metodo=${usandoSenhaAmbiente ? "ENV" : "SQLITE"} | usuario=${usuarioLogado}`);
  const sessao = store.criarSessao(usuarioLogado);
  return res.json({
    ok: true,
    token: sessao.token,
    expiraEm: sessao.expiraEm,
    usuario: usuarioLogado,
    origemAuth: usandoSenhaAmbiente ? "environment" : "sqlite",
  });
});

app.post("/api/auth/logout", (req, res) => {
  const token = extrairToken(req);
  store.revogarSessao(token);
  res.json({ ok: true });
});

app.get("/api/auth/me", exigirAuth, (req, res) => {
  const token = extrairToken(req);
  const sess = store.validarSessao(token);
  const auth = lerAuth();
  res.json({
    ok: true,
    usuario: (sess && sess.usuario) || auth.usuario,
    expiraEm: sess ? sess.expiraEm : null,
  });
});

app.put("/api/auth/senha", exigirAuth, (req, res) => {
  // Com ADMIN_PASSWORD configurada no Render, a credencial é controlada pelo Environment.
  // Evita o painel informar que trocou uma senha que continuaria sendo sobrescrita pelo Render.
  if (String(process.env.ADMIN_PASSWORD || "").trim().length > 0) {
    return res.status(409).json({
      erro: "A senha do painel está sendo controlada pelo Render. Altere ADMIN_PASSWORD em Environment e faça um novo deploy."
    });
  }

  const { usuario, senha, senhaAtual } = req.body || {};
  if (!usuario || !senha || String(senha).length < 8) {
    return res.status(400).json({ erro: "Usuário e senha nova (mín. 8 caracteres) são obrigatórios." });
  }
  const auth = lerAuth();
  // Exige senha atual para trocar (exceto se ainda estiver em texto puro legado e coincidir)
  if (senhaAtual != null && senhaAtual !== "") {
    if (!verificarSenha(senhaAtual, auth.senha)) {
      return res.status(401).json({ erro: "Senha atual incorreta." });
    }
  }
  auth.usuario = String(usuario).trim();
  auth.senha = hashSenha(senha);
  // Campo legado mantido apenas por compatibilidade estrutural do SQLite.
  // Esse valor nunca é aceito como autenticação.
  auth.tokenSecreto = crypto.randomBytes(32).toString("hex");
  store.salvarAuth(auth);
  store.revogarTodasSessoes();
  const sessao = store.criarSessao(auth.usuario);
  res.json({
    ok: true,
    mensagem: "Credenciais atualizadas. Outras sessões foram encerradas.",
    token: sessao.token,
    expiraEm: sessao.expiraEm,
  });
});

/* ---------- MENU ---------- */
app.get("/api/menu", (req, res) => {
  const menu = lerMenuOficial();
  if (!menu) return res.status(404).json({ erro: "menu.json não encontrado" });
  // Injeta chave PIX das variáveis de ambiente (nunca exposta no repositório)
  aplicarPixSeguro(menu);
  res.json(menu);
});

app.put("/api/menu", exigirAuth, (req, res) => {
  const menu = req.body;
  if (!menu || typeof menu !== "object" || !menu.restaurante || !Array.isArray(menu.produtos) || menu.produtos.length > 1000) {
    return res.status(400).json({ erro: "JSON de menu inválido." });
  }
  // Se PIX estiver protegido por env, ignora qualquer alteração vinda do painel/git
  const envPix = pixDoAmbiente();
  if (envPix) {
    menu.restaurante = menu.restaurante || {};
    menu.restaurante.pix = {
      chave: "",
      tipo: envPix.tipo,
      titular: "",
      cidade: envPix.cidade,
      protegido: true,
    };
  } else if (menu.restaurante && menu.restaurante.pix) {
    // sem env: permite salvar, mas não versionamos segredo no código
  }
  salvarMenuOficial(menu);
  const resposta = JSON.parse(JSON.stringify(menu));
  aplicarPixSeguro(resposta);
  res.json({ ok: true, mensagem: envPix ? "Cardápio salvo (PIX protegido por variável de ambiente)." : "Cardápio salvo no servidor.", menu: resposta });
});

/* ---------- PEDIDOS ---------- */
app.get("/api/pedidos", exigirAuth, (req, res) => {
  res.json(store.listarPedidos());
});

app.get("/api/pedidos/resumo", exigirAuth, (req, res) => {
  const pedidos = store.listarPedidos();
  const agora = new Date();
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const hoje = pedidos.filter((p) => (p.ts || 0) >= inicioHoje && p.status !== "cancelado");
  const andamento = pedidos.filter((p) =>
    ["recebido", "preparando", "pronto", "saiu_entrega"].includes(p.status)
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

function localizarCupom(codigo) {
  const normalizado = String(codigo || "").trim().toUpperCase();
  if (!normalizado) return { menu: null, cupom: null };
  const menu = lerMenuOficial();
  const cupom = menu && Array.isArray(menu.cupons)
    ? menu.cupons.find((c) => String(c.codigo || "").trim().toUpperCase() === normalizado)
    : null;
  return { menu, cupom };
}

function registrarUsoCupomPedido(pedido) {
  if (!pedido.cupom || pedido.cupomContabilizadoEm) return;
  const { menu, cupom } = localizarCupom(pedido.cupom);
  if (!menu || !cupom || cupom.ativo === false) return;
  cupom.usos = (Number(cupom.usos) || 0) + 1;
  pedido.cupomContabilizadoEm = Date.now();
  salvarMenuOficial(menu);
}

function hashChaveRoleta(chave) {
  const valor = String(chave || "").trim();
  if (valor.length < 32 || valor.length > 128) return "";
  return crypto.createHash("sha256").update(valor, "utf8").digest("hex");
}

const moeda = regras.moeda;

function erroPedido(status, mensagem) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function chaveRoletaAutorizada(cliente, chaveHash) {
  if (!cliente || !chaveHash) return false;
  const chaves = Array.isArray(cliente.roletaChaves)
    ? cliente.roletaChaves
    : (cliente.roletaChaveHash ? [cliente.roletaChaveHash] : []);
  return chaves.some((hashSalvo) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(String(hashSalvo), "hex"),
        Buffer.from(chaveHash, "hex")
      );
    } catch (e) {
      return false;
    }
  });
}

function premioRoletaDoPedido(body) {
  const premioId = String(body.premioRoletaId || "").trim();
  if (!premioId) return null;
  const tel = normalizarTelefone(body.telefone);
  const chaveHash = hashChaveRoleta(body.roletaChave || "");
  const db = lerClientes();
  const cliente = db[tel];
  if (!cliente || !chaveRoletaAutorizada(cliente, chaveHash)) {
    throw erroPedido(403, "Não foi possível validar o prêmio da roleta neste aparelho.");
  }
  limparPremiosExpirados(cliente);
  const premio = (cliente.premios || []).find((p) => p.id === premioId);
  if (!premio || premio.status !== "disponivel") {
    throw erroPedido(409, "Prêmio da roleta inválido, utilizado ou expirado.");
  }
  if (premio.expiraEm && premio.expiraEm < Date.now()) {
    throw erroPedido(409, "Prêmio da roleta expirado.");
  }
  return { tel, db, cliente, premio };
}

function calcularTaxaServidor(menu, body) {
  if (String(body.tipoEntrega || "entrega") === "retirada") return 0;
  const bairro = String(body.bairro || "").trim().toLocaleLowerCase("pt-BR");
  const zona = Array.isArray(menu.taxasEntrega)
    ? menu.taxasEntrega.find((z) => String(z.nome || "").trim().toLocaleLowerCase("pt-BR") === bairro)
    : null;
  return moeda(zona ? zona.valor : menu.restaurante?.taxaEntrega || 0);
}

const lojaAbertaAgora = regras.lojaAbertaEm;

function adicionaisOficiais(menu, produto, item) {
  const permitidos = new Set(Array.isArray(produto.adicionais) ? produto.adicionais : []);
  const escolhaUnica = new Set(Array.isArray(produto.escolhaUnicaIds) ? produto.escolhaUnicaIds : []);
  const catalogo = new Map((menu.adicionaisDisponiveis || []).map((a) => [String(a.id), a]));
  const gruposRecebidos = Array.isArray(item.adicionaisPorLancheIds) && item.adicionaisPorLancheIds.length
    ? item.adicionaisPorLancheIds
    : [Array.isArray(item.adicionaisIds) ? item.adicionaisIds : []];
  const normalizados = [];
  let total = 0;
  for (const grupoRecebido of gruposRecebidos.slice(0, 10)) {
    const ids = [...new Set((Array.isArray(grupoRecebido) ? grupoRecebido : []).map(String))];
    if (ids.filter((id) => escolhaUnica.has(id)).length > 1) {
      throw erroPedido(400, `Escolha inválida de adicionais para ${produto.nome}.`);
    }
    const grupo = [];
    for (const id of ids) {
      const adicional = catalogo.get(id);
      if (!adicional || !permitidos.has(id)) {
        throw erroPedido(400, `Adicional inválido para ${produto.nome}.`);
      }
      const oficial = { id, nome: String(adicional.nome || "Adicional"), preco: moeda(adicional.preco || 0) };
      grupo.push(oficial);
      normalizados.push(oficial);
      total += oficial.preco;
    }
  }
  return { adicionais: normalizados, total: moeda(total) };
}

function calcularPedidoPublico(body) {
  const menu = lerMenuOficial();
  if (!menu || !Array.isArray(menu.produtos)) throw erroPedido(503, "Cardápio indisponível.");
  if (!lojaAbertaAgora(menu)) throw erroPedido(409, "A loja está fechada no momento.");
  if (!Array.isArray(body.itens) || !body.itens.length || body.itens.length > 60) {
    throw erroPedido(400, "Quantidade de itens inválida.");
  }

  const premioInfo = premioRoletaDoPedido(body);
  const premio = premioInfo?.premio || null;
  const itens = [];
  let subtotal = 0;

  for (const recebido of body.itens) {
    if (recebido?.premioRoleta === true) continue; // será incluído abaixo após validação
    const produtoId = String(recebido?.produtoId || "").trim();
    const produto = menu.produtos.find((p) => String(p.id) === produtoId);
    if (!produto || produto.disponivel === false) {
      throw erroPedido(400, "Produto inválido ou indisponível no pedido.");
    }
    const quantidade = Math.max(1, Math.min(20, Math.trunc(Number(recebido.quantidade) || 1)));
    const extras = adicionaisOficiais(menu, produto, recebido || {});
    const precoUnitario = moeda((Number(produto.preco) || 0) + extras.total);
    subtotal += precoUnitario * quantidade;
    itens.push({
      produtoId: String(produto.id),
      nome: String(produto.nome || "Produto"),
      quantidade,
      preco: precoUnitario,
      adicionais: extras.adicionais,
      observacao: String(recebido.observacao || "").slice(0, 500),
    });
  }

  if (premio && premio.tipo === "produto_gratis") {
    const produtoGratis = menu.produtos.find((p) => String(p.id) === String(premio.produtoId));
    if (!produtoGratis || produtoGratis.disponivel === false) {
      throw erroPedido(409, "Produto do prêmio não está disponível.");
    }
    itens.push({
      produtoId: String(produtoGratis.id),
      nome: String(produtoGratis.nome || premio.nome || "Prêmio"),
      quantidade: 1,
      preco: 0,
      premioRoleta: true,
    });
  }

  if (!itens.length) throw erroPedido(400, "Pedido sem itens válidos.");
  subtotal = moeda(subtotal);
  const minimo = moeda(menu.restaurante?.pedidoMinimoEntrega || 0);
  if (String(body.tipoEntrega || "entrega") !== "retirada" && subtotal < minimo) {
    throw erroPedido(400, `Pedido mínimo para entrega: R$ ${minimo.toFixed(2).replace(".", ",")}.`);
  }
  const taxa = calcularTaxaServidor(menu, body);
  let descontoCupom = 0;
  let cupomCodigo = null;
  if (body.cupom) {
    const cupom = (menu.cupons || []).find(
      (c) => String(c.codigo || "").trim().toUpperCase() === String(body.cupom).trim().toUpperCase()
    );
    if (!cupom || cupom.ativo === false) throw erroPedido(400, "Cupom inválido ou inativo.");
    if (Number(cupom.usoMaximo) > 0 && (Number(cupom.usos) || 0) >= Number(cupom.usoMaximo)) {
      throw erroPedido(409, "Cupom esgotado.");
    }
    if (subtotal < (Number(cupom.minimo) || 0)) {
      throw erroPedido(400, "O pedido não atingiu o valor mínimo do cupom.");
    }
    descontoCupom = regras.calcularDescontoCupom(subtotal, cupom);
    cupomCodigo = String(cupom.codigo || "").toUpperCase();
  }

  const descontoPremio = premio && premio.tipo === "desconto_percentual"
    ? moeda(subtotal * (Number(premio.valor) || 0) / 100)
    : 0;
  const base = moeda(subtotal + taxa);
  const desconto = moeda(Math.min(base, Math.max(0, descontoCupom + descontoPremio)));
  return {
    itens,
    subtotal,
    taxa,
    desconto,
    total: moeda(Math.max(0, base - desconto)),
    cupom: cupomCodigo,
    premioInfo,
    premioRoletaId: premio ? premio.id : null,
    premioRoletaNome: premio ? premio.nome : null,
  };
}

function calcularPedidoManual(body) {
  const itens = (Array.isArray(body.itens) ? body.itens : []).slice(0, 60).map((i) => ({
    nome: String(i?.nome || "Item manual").slice(0, 160),
    quantidade: Math.max(1, Math.min(100, Math.trunc(Number(i?.quantidade) || 1))),
    preco: moeda(Math.max(0, Number(i?.preco) || 0)),
    observacao: String(i?.observacao || "").slice(0, 500),
  }));
  if (!itens.length) throw erroPedido(400, "Pedido manual sem itens.");
  const total = moeda(itens.reduce((s, i) => s + i.preco * i.quantidade, 0));
  return { itens, subtotal: total, taxa: 0, desconto: 0, total, cupom: null, premioInfo: null };
}

app.post("/api/pedidos", limitar({ janelaMs: 60 * 1000, max: 12, chave: "pedidos" }), (req, res) => {
  const body = req.body || {};
  if (!body.itens || !Array.isArray(body.itens) || !body.itens.length) {
    return res.status(400).json({ erro: "Pedido sem itens." });
  }

  // Reenvios do mesmo pedido (fetch keepalive/fallback) não criam outro
  // registro nem consomem benefícios novamente.
  const idCliente = String(body.id || "").trim();
  if (/^p-[a-z0-9-]{6,80}$/i.test(idCliente)) {
    const existente = store.obterPedido(idCliente);
    if (existente) return res.status(200).json({
      ok: true, id: existente.id, numero: existente.numero, duplicado: true
    });
  }

  const manualAutenticado = body.manual === true && tokenValido(req);
  let calculo;
  try {
    calculo = manualAutenticado ? calcularPedidoManual(body) : calcularPedidoPublico(body);
  } catch (e) {
    return res.status(e.status || 400).json({ erro: e.message || "Pedido inválido." });
  }

  const texto = regras.limitarTexto;
  const tipoEntrega = String(body.tipoEntrega || "entrega") === "retirada" ? "retirada" : "entrega";
  const clienteNome = texto(body.cliente, 120);
  const telefone = normalizarTelefone(body.telefone).slice(0, 15);
  if (!manualAutenticado && (clienteNome.length < 2 || telefone.length < 10)) {
    return res.status(400).json({ erro: "Informe nome e telefone válidos." });
  }
  if (!manualAutenticado && tipoEntrega === "entrega" && !texto(body.endereco, 240)) {
    return res.status(400).json({ erro: "Informe o endereço para entrega." });
  }
  const roletaChaveHash = hashChaveRoleta(body.roletaChave);
  const pedido = {
    id: /^p-[a-z0-9-]{6,80}$/i.test(idCliente)
      ? idCliente
      : "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    numero: /^[A-Z0-9-]{3,30}$/i.test(text(body.numero, 30)) ? text(body.numero, 30) : idCurto(),
    ts: Date.now(),
    status: "recebido",
    total: calculo.total,
    subtotal: calculo.subtotal,
    taxa: calculo.taxa,
    desconto: calculo.desconto,
    cupom: calculo.cupom,
    premioRoletaId: calculo.premioRoletaId || null,
    premioRoletaNome: calculo.premioRoletaNome || null,
    cliente: clienteNome,
    telefone,
    tipoEntrega,
    formaPagamento: texto(body.formaPagamento, 60),
    endereco: texto(body.endereco, 240),
    bairro: texto(body.bairro, 100),
    complemento: texto(body.complemento || body.referencia, 240),
    referencia: texto(body.referencia || body.complemento, 240),
    troco: texto(body.troco, 40),
    observacao: texto(body.observacao, 500),
    itens: calculo.itens,
    manual: manualAutenticado,
    origem: manualAutenticado ? "painel-manual" : "cardapio",
    roletaChaveHash: roletaChaveHash || undefined,
  };
  store.inserirPedido(pedido);

  if (calculo.premioInfo) {
    const { tel, db, cliente, premio } = calculo.premioInfo;
    premio.status = "utilizado";
    premio.utilizadoEm = Date.now();
    premio.pedidoId = pedido.id;
    db[tel] = cliente;
    salvarClientes(db);
  }

  broadcastPedido("novo", pedido);
  const respostaPublica = { ...pedido };
  delete respostaPublica.roletaChaveHash;
  res.status(201).json(respostaPublica);
});

/* SSE — painel escuta novos pedidos sem precisar recarregar a página.
   A autenticação é aceita somente no header Authorization. O painel usa
   fetch streaming, evitando que o token apareça em URL, logs ou histórico.
   IMPORTANTE: esta rota precisa vir ANTES de /api/pedidos/:id */
app.get("/api/pedidos/stream", (req, res) => {
  const token = extrairToken(req);
  if (!token || !tokenValido(req)) {
    return res.status(401).json({ erro: "Não autenticado." });
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      if (!store.validarSessao(token)) {
        clearInterval(heartbeat);
        sseClients.delete(res);
        return res.end();
      }
      res.write(`: ping ${Date.now()}\n\n`);
    } catch (e) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.get("/api/pedidos/:id", exigirAuth, (req, res) => {
  const p = store.obterPedido(req.params.id);
  if (!p) return res.status(404).json({ erro: "Pedido não encontrado." });
  res.json(p);
});

app.patch("/api/pedidos/:id/status", exigirAuth, (req, res) => {
  let status = req.body?.status;
  // Fluxo: recebido → preparando → pronto → saiu_entrega → entregue | cancelado
  const validos = ["recebido", "preparando", "pronto", "saiu_entrega", "entregue", "cancelado"];
  if (!validos.includes(status)) {
    return res.status(400).json({ erro: "Status inválido.", validos });
  }
  const pedido = store.obterPedido(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  const statusAnterior = pedido.status;
  if (!regras.transicaoStatusValida(statusAnterior, status)) {
    return res.status(409).json({ erro: `Transição inválida: ${statusAnterior} → ${status}.` });
  }
  pedido.status = status;
  pedido.atualizadoEm = Date.now();
  // Benefícios só são contabilizados depois que o painel autenticado confirma
  // a entrega. Requisições públicas falsas não esgotam cupons nem geram giros.
  if (status === "entregue" && statusAnterior !== "entregue" && !pedido.beneficiosConcedidosEm) {
    try {
      registrarUsoCupomPedido(pedido);
      concederGiroPorPedidoEntregue(pedido);
      pedido.beneficiosConcedidosEm = Date.now();
    } catch (e) {
      console.warn("Falha ao contabilizar benefícios do pedido:", e.message);
    }
  }
  store.atualizarPedido(pedido);
  broadcastPedido("status", pedido);
  res.json(pedido);
});


app.post("/api/pedidos/:id/impressao/reservar", exigirAuth, (req, res) => {
  const pedido = store.obterPedido(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  const agora = Date.now();
  if (pedido.impressoEm || (pedido.impressaoReservadaEm && agora - pedido.impressaoReservadaEm < 60000)) {
    return res.status(409).json({ erro: "Pedido já impresso ou reservado por outro painel." });
  }
  pedido.impressaoReservadaEm = agora;
  store.atualizarPedido(pedido);
  res.json({ ok: true, reservadoEm: agora });
});


app.patch("/api/pedidos/:id/impressao", exigirAuth, (req, res) => {
  const pedido = store.obterPedido(req.params.id);
  if (!pedido) return res.status(404).json({ erro: "Pedido não encontrado." });
  const agora = Date.now();
  if (!pedido.impressoEm) {
    pedido.impressoEm = agora;
    pedido.impressoes = 1;
  } else {
    pedido.reimpressoEm = agora;
    pedido.impressoes = (Number(pedido.impressoes) || 1) + 1;
  }
  delete pedido.impressaoReservadaEm;
  store.atualizarPedido(pedido);
  broadcastPedido("status", pedido);
  res.json(pedido);
});

// Ajuste manual reservado ao painel. O fluxo normal contabiliza o cupom
// automaticamente quando o pedido é marcado como entregue.
app.post("/api/cupons/usar", exigirAuth, (req, res) => {
  const codigo = String(req.body?.codigo || "").trim().toUpperCase();
  if (!codigo) return res.status(400).json({ erro: "Código obrigatório." });
  const menu = lerMenuOficial();
  if (!menu || !Array.isArray(menu.cupons)) {
    return res.status(404).json({ erro: "Cupom não encontrado." });
  }
  const c = menu.cupons.find((x) => String(x.codigo || "").toUpperCase() === codigo);
  if (!c || c.ativo === false) return res.status(404).json({ erro: "Cupom inválido." });
  if (c.usoMaximo > 0 && (c.usos || 0) >= c.usoMaximo) {
    return res.status(409).json({ erro: "Cupom esgotado." });
  }
  c.usos = (Number(c.usos) || 0) + 1;
  salvarMenuOficial(menu);
  res.json({ ok: true, usos: c.usos });
});


/* ---------- ROLETA DA SORTE ---------- */
const normalizarTelefone = regras.normalizarTelefone;

function lerClientes() {
  return store.lerClientes();
}

function salvarClientes(dados) {
  store.salvarClientes(dados);
}

function lerRoletaConfig() {
  return store.lerRoletaConfig();
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

function exigirAcessoRoleta(req, res, next) {
  // O administrador continua podendo prestar suporte usando sua sessão.
  if (tokenValido(req)) return next();

  const tel = normalizarTelefone(req.params?.telefone || req.body?.telefone);
  const chaveHash = hashChaveRoleta(req.headers["x-roleta-key"]);
  if (!tel || tel.length < 10 || !chaveHash) {
    return res.status(401).json({ erro: "Identificação da roleta inválida." });
  }

  const cliente = lerClientes()[tel];
  const chaves = cliente && Array.isArray(cliente.roletaChaves)
    ? cliente.roletaChaves
    : (cliente?.roletaChaveHash ? [cliente.roletaChaveHash] : []);
  const autorizado = chaves.some((hashSalvo) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(String(hashSalvo), "hex"),
        Buffer.from(chaveHash, "hex")
      );
    } catch (e) {
      return false;
    }
  });

  if (!autorizado) {
    return res.status(403).json({
      erro: "Este aparelho ainda não está autorizado para esse telefone. Faça um pedido e aguarde ele ser marcado como entregue."
    });
  }
  next();
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

// Liga/desliga a roleta (e opcionalmente atualiza prêmios/validade) — uso do painel
app.put("/api/roleta/config", exigirAuth, (req, res) => {
  const atual = lerRoletaConfig();
  const body = req.body || {};
  const novo = {
    ativo: typeof body.ativo === "boolean" ? body.ativo : !!atual.ativo,
    premios: Array.isArray(body.premios) ? body.premios : atual.premios || [],
    validadeDias: Number.isFinite(Number(body.validadeDias)) ? Number(body.validadeDias) : (atual.validadeDias || 7),
  };
  store.salvarRoletaConfig(novo);
  res.json({ ok: true, config: novo });
});

app.get("/api/roleta/cliente/:telefone", exigirAcessoRoleta, (req, res) => {
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

app.post("/api/roleta/girar", limitar({ janelaMs: 60 * 1000, max: 10, chave: "roleta" }), exigirAcessoRoleta, (req, res) => {
  const telRaw = req.body?.telefone;
  const info = obterCliente(telRaw);
  if (!info) return res.status(400).json({ erro: "Telefone inválido." });
  const { cliente, db, tel } = info;
  limparPremiosExpirados(cliente);

  if ((cliente.giros || 0) < 1) {
    return res.status(409).json({ erro: "Você não possui giros disponíveis." });
  }

  const cfg = lerRoletaConfig();
  if (cfg.ativo === false) {
    return res.status(409).json({ erro: "A roleta está desativada no momento." });
  }
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

app.post("/api/roleta/resgatar", exigirAcessoRoleta, (req, res) => {
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
  // Vincula o aparelho que originou o pedido somente após a confirmação
  // de entrega pelo painel. Mantém até 5 aparelhos autorizados por cliente.
  if (pedido.roletaChaveHash) {
    const chaves = Array.isArray(c.roletaChaves) ? c.roletaChaves : [];
    c.roletaChaves = [pedido.roletaChaveHash, ...chaves.filter((h) => h !== pedido.roletaChaveHash)].slice(0, 5);
    delete c.roletaChaveHash;
  }
  // primeira compra também garante o giro (já coberto pelo +1 acima)
  db[tel] = c;
  salvarClientes(db);
}

/* ---------- health ---------- */
app.get("/api/health", (req, res) => {
  const mem = process.memoryUsage();
  let banco = null;
  try {
    banco = store.infoDb();
  } catch (e) {
    banco = { tipo: "sqlite", erro: e.message };
  }
  res.json({
    ok: true,
    versao: "1.0.1",
    ts: Date.now(),
    armazenamento: banco ? { tipo: banco.tipo, pedidos: banco.pedidos, clientes: banco.clientes } : null,
    memoria: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsadoMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      externalMB: Math.round(mem.external / 1024 / 1024),
    },
  });
});

/* ---------- bloqueia acesso público à pasta backend/ ----------
   IMPORTANTE: sem isso, express.static(ROOT) serviria backend/data/*.json
   (auth.json com a senha, clientes.json, pedidos.json) para qualquer
   pessoa que acessasse a URL diretamente. */
app.use("/backend", (req, res) => res.status(404).end());

/* ---------- não cachear painel administrativo ---------- */
app.use((req, res, next) => {
  if (
    req.path === "/painel.html" ||
    req.path === "/painel-de-controle.html" ||
    req.path.startsWith("/api/")
  ) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});

/* ---------- estáticos (site) ---------- */
app.get(["/painel-de-controle.html", "/painel de controle.html"], (req, res) => {
  res.redirect(302, "/painel.html");
});

app.get("/painel.html", (req, res, next) => {
  try {
    const nonce = crypto.randomBytes(18).toString("base64");
    const painelFile = path.join(ROOT, "painel.html");
    let html = fs.readFileSync(painelFile, "utf8");
    // Somente scripts que fazem parte do HTML original recebem o nonce.
    // Conteúdo injetado por innerHTML não consegue criar um script autorizado.
    html = html.replace(/<script\b/gi, `<script nonce="${nonce}"`);

    const connects = [
      "'self'",
      ...origensPermitidas,
      "wss://localhost:*",
      "ws://localhost:*",
      "wss://127.0.0.1:*",
      "ws://127.0.0.1:*",
      "wss://localhost.qz.io:*",
      "ws://localhost.qz.io:*",
    ].join(" ");

    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; ` +
      `form-action 'self'; script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https://cdn.jsdelivr.net; ` +
      `style-src 'self' 'unsafe-inline'; font-src 'self' data:; ` +
      `img-src 'self' data: blob: https:; connect-src ${connects}`
    );
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.type("html").send(html);
  } catch (e) {
    next(e);
  }
});

app.use(express.static(ROOT));

app.use((err, req, res, next) => {
  console.error(`[erro] ${req.method} ${req.path}:`, err && err.message ? err.message : err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ erro: err.status ? err.message : "Erro interno do servidor." });
});

let servidor = null;

function iniciar(porta = PORT) {
  if (servidor) return servidor;
  servidor = app.listen(porta, () => {
    const endereco = servidor.address();
    const portaReal = typeof endereco === "object" ? endereco.port : porta;
    console.log(`Brutu's API + site em http://localhost:${portaReal}`);
    console.log(`Painel: http://localhost:${portaReal}/painel.html`);
    console.log(`Cardápio: http://localhost:${portaReal}/`);
  });
  return servidor;
}

function encerrar(sinal) {
  console.log(`[shutdown] ${sinal}: encerrando conexões...`);
  for (const res of sseClients) { try { res.end(); } catch {} }
  if (!servidor) return;
  servidor.close(() => {
    store.fechar();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

if (require.main === module) {
  iniciar();
  process.once("SIGTERM", () => encerrar("SIGTERM"));
  process.once("SIGINT", () => encerrar("SIGINT"));
}

module.exports = { app, iniciar };

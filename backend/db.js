/**
 * Brutu's Delivery — camada SQLite (módulo nativo node:sqlite)
 *
 * Substitui pedidos.json, auth.json, clientes.json e roleta-config.json.
 * O cardápio (menu.json) continua em arquivo JSON (editado pelo painel).
 *
 * Caminho do banco:
 *   process.env.DATABASE_PATH / process.env.DB_PATH  ou  backend/data/brutus.db
 *
 * Na primeira subida, importa automaticamente os JSON antigos se existirem.
 * Requer Node.js 22.5+ (Render costuma usar LTS recente).
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
// Em produção (Railway), monte um Volume em /data e defina:
//   DATABASE_PATH=/data/brutus.db
// DB_PATH também é aceito por compatibilidade.
const DB_PATH =
  process.env.DATABASE_PATH ||
  process.env.DB_PATH ||
  path.join(DATA_DIR, "brutus.db");

const AUTH_DEFAULT = {
  usuario: String(process.env.ADMIN_USER || "admin").trim() || "admin",
  senha: "",
  tokenSecreto: crypto.randomBytes(32).toString("hex"),
};

let db;

function fechar() {
  if (!db) return;
  try { db.close(); } finally { db = undefined; }
}

function abrir() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
  } catch (e) {
    /* alguns ambientes bloqueiam WAL em disco efêmero — segue sem */
  }
  db.exec("PRAGMA foreign_keys = ON;");
  criarTabelas();
  migrarJsonSeNecessario();
  aplicarAtualizacoesCatalogo();
  invalidarCredenciaisLegadas();
  return db;
}

function aplicarAtualizacoesCatalogo() {
  const revisao = "catalogo-2026-08-brutus-pickles";
  const pronta = db.prepare("SELECT valor FROM meta WHERE chave = ?").get(revisao);
  if (pronta?.valor === "1") return;

  const seed = lerJsonArquivo(path.join(__dirname, "..", "data", "menu.json"), null);
  const row = db.prepare("SELECT valor FROM config WHERE chave = ?").get("menu");
  let menu = null;
  try { menu = row ? JSON.parse(row.valor) : null; } catch {}

  if (seed && menu && Array.isArray(seed.produtos) && Array.isArray(menu.produtos)) {
    const ids = new Set(menu.produtos.map((p) => String(p.id)));
    for (const id of ["g009"]) {
      const produto = seed.produtos.find((p) => String(p.id) === id);
      if (produto && !ids.has(id)) menu.produtos.push(produto);
    }
    db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)").run("menu", JSON.stringify(menu));
  }
  db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES (?, ?)").run(revisao, "1");
}

function invalidarCredenciaisLegadas() {
  const row = db.prepare("SELECT senha FROM auth WHERE id = 1").get();
  const senha = String(row?.senha || "");
  const senhaSegura = senha.startsWith("scrypt$") ? senha : "";
  // Remove qualquer senha antiga em texto puro e substitui o token legado
  // armazenado. A API não aceita esse token, mas também não o preservamos.
  db.prepare("UPDATE auth SET senha = ?, token_secreto = ? WHERE id = 1").run(
    senhaSegura,
    crypto.randomBytes(32).toString("hex")
  );
}

function criarTabelas() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      usuario TEXT NOT NULL,
      senha TEXT NOT NULL,
      token_secreto TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pedidos (
      id TEXT PRIMARY KEY,
      numero TEXT,
      ts INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'recebido',
      total REAL DEFAULT 0,
      dados TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pedidos_ts ON pedidos(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
    CREATE INDEX IF NOT EXISTS idx_pedidos_numero ON pedidos(numero);

    CREATE TABLE IF NOT EXISTS clientes (
      telefone TEXT PRIMARY KEY,
      dados TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      token TEXT PRIMARY KEY,
      usuario TEXT NOT NULL,
      criado_em INTEGER NOT NULL,
      expira_em INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(expira_em);
  `);
}

function lerJsonArquivo(arquivo, fallback) {
  try {
    if (!fs.existsSync(arquivo)) return fallback;
    return JSON.parse(fs.readFileSync(arquivo, "utf8"));
  } catch {
    return fallback;
  }
}

function migrarJsonSeNecessario() {
  const flag = db.prepare("SELECT valor FROM meta WHERE chave = ?").get("migrado_json");
  if (flag && flag.valor === "1") return;

  const authCount = db.prepare("SELECT COUNT(*) AS n FROM auth").get().n;
  const pedidosCount = db.prepare("SELECT COUNT(*) AS n FROM pedidos").get().n;
  const clientesCount = db.prepare("SELECT COUNT(*) AS n FROM clientes").get().n;
  const roletaRow = db.prepare("SELECT valor FROM config WHERE chave = ?").get("roleta");
  const menuRow = db.prepare("SELECT valor FROM config WHERE chave = ?").get("menu");

  if (authCount === 0) {
    const auth = lerJsonArquivo(path.join(DATA_DIR, "auth.json"), {});
    // Nunca importa senha legada em texto puro. Instalações novas devem usar
    // ADMIN_PASSWORD; somente um hash scrypt já existente pode ser migrado.
    const senhaSegura = String(auth.senha || "").startsWith("scrypt$")
      ? String(auth.senha)
      : "";
    db.prepare(
      "INSERT INTO auth (id, usuario, senha, token_secreto) VALUES (1, ?, ?, ?)"
    ).run(
      auth.usuario || AUTH_DEFAULT.usuario,
      senhaSegura,
      crypto.randomBytes(32).toString("hex")
    );
  }

  if (pedidosCount === 0) {
    const lista = lerJsonArquivo(path.join(DATA_DIR, "pedidos.json"), []);
    if (Array.isArray(lista) && lista.length) {
      const ins = db.prepare(
        "INSERT OR REPLACE INTO pedidos (id, numero, ts, status, total, dados) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const p of lista) {
        if (!p || !p.id) continue;
        ins.run(
          p.id,
          p.numero || null,
          p.ts || Date.now(),
          p.status || "recebido",
          Number(p.total) || 0,
          JSON.stringify(p)
        );
      }
      console.log("[db] Migrados " + lista.length + " pedido(s) de pedidos.json");
    }
  }

  if (clientesCount === 0) {
    const mapa = lerJsonArquivo(path.join(DATA_DIR, "clientes.json"), {});
    const keys = Object.keys(mapa || {});
    if (keys.length) {
      const ins = db.prepare("INSERT OR REPLACE INTO clientes (telefone, dados) VALUES (?, ?)");
      for (const tel of keys) {
        ins.run(tel, JSON.stringify(mapa[tel]));
      }
      console.log("[db] Migrados " + keys.length + " cliente(s) de clientes.json");
    }
  }

  if (!roletaRow) {
    const cfg = lerJsonArquivo(path.join(DATA_DIR, "roleta-config.json"), {
      ativo: true,
      premios: [],
      validadeDias: 7,
    });
    db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)").run(
      "roleta",
      JSON.stringify(cfg)
    );
  }

  if (!menuRow) {
    const menu = lerJsonArquivo(path.join(__dirname, "..", "data", "menu.json"), null);
    if (menu) {
      db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)").run(
        "menu",
        JSON.stringify(menu)
      );
    }
  }

  db.prepare("INSERT OR REPLACE INTO meta (chave, valor) VALUES (?, ?)").run("migrado_json", "1");
  console.log("[db] SQLite pronto em " + DB_PATH);
}

function lerMenu(fallback = null) {
  abrir();
  const row = db.prepare("SELECT valor FROM config WHERE chave = ?").get("menu");
  if (!row) return fallback;
  try { return JSON.parse(row.valor); } catch { return fallback; }
}

function salvarMenu(menu) {
  abrir();
  db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)").run(
    "menu",
    JSON.stringify(menu)
  );
  return menu;
}

function lerAuth() {
  abrir();
  const row = db.prepare("SELECT usuario, senha, token_secreto FROM auth WHERE id = 1").get();
  const auth = row
    ? { usuario: row.usuario, senha: row.senha, tokenSecreto: row.token_secreto }
    : { ...AUTH_DEFAULT };
  return auth;
}

function salvarAuth(auth) {
  abrir();
  db.prepare(
    "INSERT INTO auth (id, usuario, senha, token_secreto) VALUES (1, ?, ?, ?) " +
    "ON CONFLICT(id) DO UPDATE SET usuario = excluded.usuario, senha = excluded.senha, token_secreto = excluded.token_secreto"
  ).run(auth.usuario, auth.senha, auth.tokenSecreto);
}

function listarPedidos() {
  abrir();
  const rows = db.prepare("SELECT dados FROM pedidos ORDER BY ts DESC LIMIT 2000").all();
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.dados);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function obterPedido(idOuNumero) {
  abrir();
  const row = db
    .prepare("SELECT dados FROM pedidos WHERE id = ? OR numero = ? LIMIT 1")
    .get(idOuNumero, idOuNumero);
  if (!row) return null;
  try {
    return JSON.parse(row.dados);
  } catch {
    return null;
  }
}

function inserirPedido(pedido) {
  abrir();
  db.prepare(
    "INSERT INTO pedidos (id, numero, ts, status, total, dados) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    pedido.id,
    pedido.numero || null,
    pedido.ts || Date.now(),
    pedido.status || "recebido",
    Number(pedido.total) || 0,
    JSON.stringify(pedido)
  );
  const total = db.prepare("SELECT COUNT(*) AS n FROM pedidos").get().n;
  if (total > 2000) {
    db.prepare(
      "DELETE FROM pedidos WHERE id IN (SELECT id FROM pedidos ORDER BY ts ASC LIMIT ?)"
    ).run(total - 2000);
  }
  return pedido;
}

function atualizarPedido(pedido) {
  abrir();
  db.prepare(
    "UPDATE pedidos SET numero = ?, ts = ?, status = ?, total = ?, dados = ? WHERE id = ?"
  ).run(
    pedido.numero || null,
    pedido.ts || Date.now(),
    pedido.status || "recebido",
    Number(pedido.total) || 0,
    JSON.stringify(pedido),
    pedido.id
  );
  return pedido;
}

function lerClientes() {
  abrir();
  const rows = db.prepare("SELECT telefone, dados FROM clientes").all();
  const mapa = {};
  for (const r of rows) {
    try {
      mapa[r.telefone] = JSON.parse(r.dados);
    } catch {
      /* ignora */
    }
  }
  return mapa;
}

function salvarCliente(telefone, dados) {
  abrir();
  db.prepare("INSERT OR REPLACE INTO clientes (telefone, dados) VALUES (?, ?)").run(
    telefone,
    JSON.stringify(dados)
  );
}

function salvarClientes(mapa) {
  abrir();
  const ins = db.prepare("INSERT OR REPLACE INTO clientes (telefone, dados) VALUES (?, ?)");
  for (const tel of Object.keys(mapa || {})) {
    ins.run(tel, JSON.stringify(mapa[tel]));
  }
}

function lerRoletaConfig() {
  abrir();
  const row = db.prepare("SELECT valor FROM config WHERE chave = ?").get("roleta");
  if (!row) return { ativo: true, premios: [], validadeDias: 7 };
  try {
    return JSON.parse(row.valor);
  } catch {
    return { ativo: true, premios: [], validadeDias: 7 };
  }
}

function salvarRoletaConfig(cfg) {
  abrir();
  db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)").run(
    "roleta",
    JSON.stringify(cfg)
  );
}

function infoDb() {
  abrir();
  return {
    tipo: "sqlite",
    caminho: DB_PATH,
    pedidos: db.prepare("SELECT COUNT(*) AS n FROM pedidos").get().n,
    clientes: db.prepare("SELECT COUNT(*) AS n FROM clientes").get().n,
  };
}


/* ---------- SESSÕES ---------- */
const SESSAO_DURACAO_MS = 12 * 60 * 60 * 1000; // 12 horas

function limparSessoesExpiradas() {
  abrir();
  db.prepare("DELETE FROM sessoes WHERE expira_em < ?").run(Date.now());
}

function criarSessao(usuario) {
  abrir();
  limparSessoesExpiradas();
  const crypto = require("crypto");
  const token = crypto.randomBytes(32).toString("hex");
  const agora = Date.now();
  db.prepare(
    "INSERT INTO sessoes (token, usuario, criado_em, expira_em) VALUES (?, ?, ?, ?)"
  ).run(token, usuario, agora, agora + SESSAO_DURACAO_MS);
  return { token, expiraEm: agora + SESSAO_DURACAO_MS };
}

function validarSessao(token) {
  if (!token) return null;
  abrir();
  const row = db.prepare(
    "SELECT token, usuario, expira_em FROM sessoes WHERE token = ?"
  ).get(token);
  if (!row) return null;
  if (row.expira_em < Date.now()) {
    db.prepare("DELETE FROM sessoes WHERE token = ?").run(token);
    return null;
  }
  return { usuario: row.usuario, expiraEm: row.expira_em };
}

function revogarSessao(token) {
  if (!token) return;
  abrir();
  db.prepare("DELETE FROM sessoes WHERE token = ?").run(token);
}

function revogarTodasSessoes() {
  abrir();
  db.prepare("DELETE FROM sessoes").run();
}

module.exports = {
  abrir,
  lerAuth,
  salvarAuth,
  listarPedidos,
  obterPedido,
  inserirPedido,
  atualizarPedido,
  lerClientes,
  salvarCliente,
  salvarClientes,
  lerRoletaConfig,
  salvarRoletaConfig,
  lerMenu,
  salvarMenu,
  infoDb,
  DB_PATH,
  criarSessao,
  validarSessao,
  revogarSessao,
  revogarTodasSessoes,
  limparSessoesExpiradas,
  fechar,
};

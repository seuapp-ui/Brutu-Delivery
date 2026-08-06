# Proteção contra IDOR — API Brutu's Delivery (Node.js + Express)

Guia pronto pra usar quando vocês construírem a API. Cobre as entidades que já existem no projeto: **pedidos**, **produtos**, **categorias**, **combos**, **cupons**, **configurações**.

---

## 1. Modelo de permissões do Brutu's Delivery

| Entidade | Quem pode ler | Quem pode criar/editar/excluir |
|---|---|---|
| Pedido | o próprio cliente (dono) + admin | admin (mudar status) |
| Produto / Categoria / Combo | público (cardápio) | só admin |
| Cupom | público (validar código) | só admin |
| Configurações da loja | público (dados básicos) | só admin |

Duas checagens diferentes, sempre nessa ordem:
1. **Autenticação** — quem é você? (token válido?)
2. **Autorização** — você pode mexer *nesse* registro específico? (é seu, ou você é admin?)

IDOR acontece quando a etapa 2 é esquecida.

---

## 2. IDs: use UUID, nunca sequencial

Pedido `1, 2, 3...` permite qualquer pessoa "passear" pelos pedidos trocando o número na URL.

```js
// models/Pedido.js
const { v4: uuidv4 } = require('uuid');

const pedidoSchema = new Schema({
  _id: { type: String, default: uuidv4 }, // UUID em vez de ObjectId sequencial
  clienteId: { type: String, required: true, index: true },
  status: String,
  itens: Array,
  total: Number,
}, { _id: false });
```

---

## 3. Middlewares centrais

```js
// middleware/autenticacao.js
const jwt = require('jsonwebtoken');

function autenticado(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ erro: 'Não autenticado' });
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido' });
  }
}

function apenasAdmin(req, res, next) {
  if (req.usuario?.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito ao administrador' });
  }
  next();
}

module.exports = { autenticado, apenasAdmin };
```

```js
// middleware/donoDoRecurso.js
// Garante que o registro pertence ao usuário logado (ou que ele é admin).
function donoDoRecurso(Model, campoDono = 'clienteId') {
  return async (req, res, next) => {
    const doc = await Model.findById(req.params.id);
    if (!doc) return res.status(404).json({ erro: 'Não encontrado' });

    const ehDono = String(doc[campoDono]) === String(req.usuario.id);
    const ehAdmin = req.usuario.role === 'admin';

    if (!ehDono && !ehAdmin) {
      return res.status(403).json({ erro: 'Sem permissão para acessar este recurso' });
    }
    req.recurso = doc; // já deixa carregado pra rota não buscar de novo
    next();
  };
}

module.exports = donoDoRecurso;
```

---

## 4. Rotas de Pedidos (a área mais sensível a IDOR)

```js
// routes/pedidos.js
const express = require('express');
const router = express.Router();
const Pedido = require('../models/Pedido');
const { autenticado, apenasAdmin } = require('../middleware/autenticacao');
const donoDoRecurso = require('../middleware/donoDoRecurso');

// Cliente vê SÓ os próprios pedidos (nunca por ID solto de outra pessoa)
router.get('/meus-pedidos', autenticado, async (req, res) => {
  const pedidos = await Pedido.find({ clienteId: req.usuario.id });
  res.json(pedidos);
});

// Ver um pedido específico — precisa ser dono OU admin
router.get('/:id', autenticado, donoDoRecurso(Pedido), (req, res) => {
  res.json(req.recurso);
});

// Só admin muda status de qualquer pedido (painel de controle)
router.patch('/:id/status', autenticado, apenasAdmin, async (req, res) => {
  const pedido = await Pedido.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true }
  );
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' });
  res.json(pedido);
});

// Cliente cancela só o próprio pedido, e só se ainda não saiu pra entrega
router.delete('/:id', autenticado, donoDoRecurso(Pedido), async (req, res) => {
  if (['saiu_entrega', 'entregue'].includes(req.recurso.status)) {
    return res.status(409).json({ erro: 'Pedido não pode mais ser cancelado' });
  }
  await req.recurso.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
```

---

## 5. Rotas de Produtos/Categorias/Combos/Cupons (só admin escreve)

Leitura é pública (é o cardápio do cliente); escrita exige `apenasAdmin` — sem checagem de "dono" porque não existe multi-tenant aqui, só um admin.

```js
// routes/produtos.js
router.get('/', async (req, res) => {           // público — cardápio
  res.json(await Produto.find());
});

router.post('/', autenticado, apenasAdmin, async (req, res) => {
  res.status(201).json(await Produto.create(req.body));
});

router.put('/:id', autenticado, apenasAdmin, async (req, res) => {
  const produto = await Produto.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado' });
  res.json(produto);
});

router.delete('/:id', autenticado, apenasAdmin, async (req, res) => {
  const produto = await Produto.findByIdAndDelete(req.params.id);
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado' });
  res.json({ ok: true });
});
```
O mesmo padrão vale para `categorias.js`, `combos.js` e `cupons.js`.

---

## 6. Erros comuns que reabrem a brecha (evite)

- **Filtrar só no front-end** (esconder o botão de editar) e deixar a rota da API aberta — o atacante chama a API direto, sem passar pela UI.
- **Confiar em campo escondido no corpo da requisição** (`req.body.clienteId`) em vez de pegar do token (`req.usuario.id`). Nunca deixe o cliente dizer de quem é o pedido.
- **Checar dono só no GET e esquecer no PUT/DELETE.**
- **Usar `findById` sem `Model.findOne({_id, clienteId})`** e só comparar depois "na mão" — mais fácil esquecer o `if`. Prefira sempre filtrar já na query.

---

## 7. Checklist de teste antes de subir pra produção

Para cada rota que recebe `:id`:
- [ ] Crie 2 usuários de teste (A e B), cada um com um pedido.
- [ ] Logado como B, tente `GET /pedidos/{id-do-pedido-de-A}` → deve dar **403/404**, nunca 200.
- [ ] Logado como B, tente `PATCH`/`DELETE` no pedido de A → deve dar **403/404**.
- [ ] Sem token nenhum, tente acessar rota admin (`POST /produtos`) → deve dar **401**.
- [ ] Com token de cliente comum, tente rota admin → deve dar **403**.
- [ ] Confirme que os IDs usados na API não são sequenciais (rode 2 cadastros seguidos e veja se dá pra "adivinhar" o próximo).

---

Quando vocês começarem a montar a API de verdade, me chama que eu já ajudo a plugar esses middlewares nas rotas reais e adapto pro banco que vocês escolherem (Mongo, Postgres, etc.).

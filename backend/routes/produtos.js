// routes/produtos.js
// Leitura é pública (cardápio do cliente); escrita exige admin.
// Sem checagem de "dono" porque não há multi-tenant aqui — só um admin.
const express = require('express');
const router = express.Router();
const Produto = require('../models/Produto');
const { autenticado, apenasAdmin } = require('../middleware/autenticacao');

router.get('/', async (req, res) => {
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

// O mesmo padrão vale para categorias.js, combos.js e cupons.js.
module.exports = router;

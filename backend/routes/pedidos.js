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

// Painel de Controle (admin) vê todos os pedidos
router.get('/', autenticado, apenasAdmin, async (req, res) => {
  const pedidos = await Pedido.find().sort({ createdAt: -1 });
  res.json(pedidos);
});

// Ver um pedido específico — precisa ser dono OU admin
router.get('/:id', autenticado, donoDoRecurso(Pedido), (req, res) => {
  res.json(req.recurso);
});

// Cliente cria um pedido — clienteId sempre vem do token, nunca do corpo
router.post('/', autenticado, async (req, res) => {
  const pedido = await Pedido.create({
    ...req.body,
    clienteId: req.usuario.id, // ignora qualquer clienteId enviado pelo cliente
  });
  res.status(201).json(pedido);
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

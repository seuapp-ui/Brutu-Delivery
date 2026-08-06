// models/Pedido.js
// Exemplo com Mongoose. Use UUID em vez de ID sequencial para não deixar
// os pedidos "adivinháveis" na URL.
const { Schema, model } = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const pedidoSchema = new Schema(
  {
    _id: { type: String, default: uuidv4 },
    clienteId: { type: String, required: true, index: true },
    itens: { type: Array, required: true },
    total: { type: Number, required: true },
    status: {
      type: String,
      enum: ['recebido', 'preparando', 'saiu_entrega', 'entregue', 'cancelado'],
      default: 'recebido',
    },
  },
  { _id: false, timestamps: true }
);

module.exports = model('Pedido', pedidoSchema);

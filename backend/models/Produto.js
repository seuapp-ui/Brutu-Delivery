// models/Produto.js
// Mesma estrutura usada hoje em data/menu.json (produtos), adaptada pra Mongoose.
const { Schema, model } = require('mongoose');

const produtoSchema = new Schema({
  categoria: { type: String, required: true },
  nome: { type: String, required: true },
  descricao: String,
  foto: String,
  preco: { type: Number, required: true },
  ingredientes: [String],
  adicionais: [String],
  destaque: { type: Boolean, default: false },
});

module.exports = model('Produto', produtoSchema);

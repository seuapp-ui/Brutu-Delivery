// middleware/donoDoRecurso.js
// Proteção contra IDOR: garante que o registro pertence ao usuário logado
// (ou que ele é admin) ANTES de qualquer leitura/edição/exclusão por :id.
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

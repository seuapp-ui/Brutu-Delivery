# Correções da versão 1.4.0

## Corrigido

- Sincronização entre `data/menu.json`, `menu.json` e `data/menu-data.js`.
- Cardápio aberto por dois cliques agora usa os mesmos produtos, preços e configurações do cardápio oficial.
- Script `npm run sync-menu` criado para evitar novas divergências.
- `npm run verify` passa a sincronizar o cardápio antes das verificações.
- Teste automático adicionado para validar o fallback de dois cliques.
- Cópias antigas dos painéis agora redirecionam ao painel unificado (`painel.html`).
- Endereço antigo do painel corrigido na documentação do backend.
- Cache do PWA alinhado com a versão 1.4.0 para liberar arquivos atualizados nos aparelhos instalados.

## Preservado

- Fluxo e montagem do pedido para WhatsApp/ZAP.
- Número e configurações do WhatsApp/ZAP.
- `render.yaml`, `Procfile` e demais configurações do Render.

## Verificação

- 19 testes aprovados.
- 0 testes com falha.
- 1 teste HTTP ignorado por dependências não instaladas no ambiente de análise.

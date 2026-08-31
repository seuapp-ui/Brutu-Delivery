# Brutu's Delivery v1.6.0

## Fluxo implementado

Ao finalizar, o cardápio registra o pedido na API online sem aguardar a resposta e abre o WhatsApp normalmente. Se a API falhar, o pedido fica em uma fila local e é reenviado automaticamente quando a conexão voltar. O mesmo ID é reutilizado, evitando duplicação.

O painel instalado conecta-se de saída ao servidor configurado em `data/site-config.js`, sincroniza pedidos ao iniciar, mantém cache local, recebe eventos SSE e usa polling como contingência. O painel abre mesmo offline.

## Configuração para produção

1. Publique esta versão no serviço Render já existente.
2. Confirme `ADMIN_USER` e `ADMIN_PASSWORD` no ambiente do Render.
3. O usuário do painel entra com essas credenciais; nenhum segredo fica no JavaScript público.
4. Se o domínio público do cardápio não for o próprio Render, acrescente-o a `ALLOWED_ORIGINS` (separado por vírgula).
5. Instale no Windows com `INSTALAR-BRUTUS.bat` como nas versões anteriores.

## Garantias

- WhatsApp não depende da API e continua abrindo mesmo se o servidor falhar.
- Pedidos feitos com o PC desligado permanecem no banco online.
- Ao ligar o PC, o painel sincroniza automaticamente os pendentes.
- SSE entrega em tempo real; polling a cada 8 segundos funciona como fallback.
- API recalcula preços do cardápio, sanitiza dados e aplica limite de requisições.
- IDs idempotentes evitam pedidos repetidos; reserva de impressão evita impressão automática duplicada.
- Banco online é a fonte dos pedidos e o armazenamento local do painel é o cache operacional.

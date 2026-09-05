# Segurança do Brutu's Delivery

## Segredos no GitHub

Nunca grave no repositório: senha administrativa, `.env`, banco SQLite,
backups, tokens, chaves privadas ou dados de clientes. Configure
`ADMIN_PASSWORD`, `DATABASE_PATH` e, se usado, `PIX_CHAVE` somente nas
variáveis de ambiente do Render/Railway ou no PC da loja.

Se algum segredo já foi publicado, removê-lo do arquivo não basta: troque a
senha/chave imediatamente e depois limpe o histórico do Git com uma ferramenta
adequada. Considere o valor antigo comprometido.

## Configuração recomendada

- Use senha administrativa única, aleatória e com pelo menos 16 caracteres.
- Ative HTTPS e mantenha `ALLOWED_ORIGINS` restrito ao domínio oficial.
- Em produção, deixe `ALLOW_LOCAL_ORIGINS=false` e `ALLOW_LAN_ORIGINS=false`.
- Mantenha o banco em volume privado; não o coloque na pasta pública do site.
- Atualize Node.js e dependências regularmente e execute `npm verify`.
- Habilite proteção de branch e varredura de segredos no GitHub.
- Faça backups criptografados e teste a restauração periodicamente.

## Resposta a incidente

Se houver suspeita de invasão: tire o painel administrativo do ar, troque
`ADMIN_PASSWORD`, encerre/reinicie o serviço para invalidar sessões, preserve
logs, revise alterações no cardápio/pedidos e só então publique uma versão
limpa. Não envie banco ou logs com dados de clientes em canais públicos.


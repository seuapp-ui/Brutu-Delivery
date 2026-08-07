# Backend — Brutu's Delivery API

API leve em **Node.js + Express** com persistência em **JSON no disco** (sem Mongo).
Serve também o site estático da pasta pai.

## Subir

```bash
cd backend
npm install
npm start
```

Abre em:

- Cardápio: http://localhost:3000/
- Painel: http://localhost:3000/painel de controle.html
- Login padrão: **admin** / **5625** (arquivo `data/auth.json`)

## O que a API faz

| Método | Rota | Auth | Função |
|--------|------|------|--------|
| POST | `/api/auth/login` | — | Login → token |
| GET | `/api/menu` | — | Lê cardápio |
| PUT | `/api/menu` | sim | Publica o menu.json do painel |
| POST | `/api/pedidos` | — | Cliente cria pedido |
| GET | `/api/pedidos` | sim | Lista pedidos |
| GET | `/api/pedidos/resumo` | sim | Dashboard (hoje) |
| PATCH | `/api/pedidos/:id/status` | sim | Status do pedido |

## Painel

1. Entre com usuário/senha
2. Edite produtos/cupons/taxas
3. Clique **Salvar** → grava no servidor
4. Aba **Pedidos**: status (recebido → preparando → saiu → entregue)
5. Polling a cada 12s + bip sonoro em pedido novo

## Produção

- Troque usuario, senha e tokenSecreto em `backend/data/auth.json`
- Use HTTPS
- Opcional: `PORT=8080 npm start`

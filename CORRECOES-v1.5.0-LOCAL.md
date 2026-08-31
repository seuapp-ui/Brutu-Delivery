# Brutu's Delivery 1.5.0 Local

## Instalação e inicialização

- Instalador de dois cliques para Windows.
- Dados persistentes fora da pasta do programa.
- Servidor iniciado automaticamente com o Windows.
- Cardápio e painel abertos somente depois do servidor ficar saudável.
- QZ Tray iniciado automaticamente quando instalado.
- Regra de Firewall para acesso pela rede Wi-Fi privada.
- Atalho que mostra o endereço correto para abrir no celular.

## Dados e backups

- Backup SQLite consistente por `VACUUM INTO`.
- Backup ao iniciar, a cada 24 horas, manual e antes de atualizar.
- Retenção dos 30 backups mais recentes.
- Restauração guiada com confirmação explícita.
- Cópia do banco atual antes de qualquer restauração.
- Desinstalador preserva os dados por padrão.

## Segurança e privacidade

- Senha atual obrigatória para trocar credenciais locais.
- Logs de login não revelam usuário nem tamanho de senha.
- Endpoint público de saúde não revela clientes, pedidos ou memória.
- Limpeza automática dos controles antigos de tentativas.
- Conteúdo do cardápio e observações escapados antes de entrar no HTML.
- Dados pessoais do navegador expiram em 90 dias.
- Histórico local reduzido de 500 para 50 pedidos recentes.

## Preservado

- Envio e montagem do pedido pelo WhatsApp/ZAP.
- Arquivos e configurações de implantação do Render.
- Painel, QZ Tray, roleta, cardápio e impressão existentes.

# Brutu's Delivery 1.5 — instalação local

1. Extraia o ZIP inteiro.
2. Execute `INSTALAR-BRUTUS.bat`.
3. Autorize o Firewall quando o Windows perguntar.
4. Crie o usuário e a senha do painel.
5. Instale o QZ Tray e selecione a impressora no painel.

## Funcionamento automático

- O servidor inicia junto com o Windows.
- O painel e o cardápio abrem depois que o servidor fica pronto.
- O QZ Tray é iniciado automaticamente quando estiver instalado.
- O banco fica em `%LOCALAPPDATA%\BrutusDeliveryData\brutus.db`.
- Um backup é criado ao iniciar e depois a cada 24 horas.
- São mantidos os 30 backups mais recentes.

## Atalhos

- `FAZER-BACKUP.bat`: cria um backup imediatamente.
- `RESTAURAR-BACKUP.bat`: permite escolher e restaurar um backup.
- `MOSTRAR-ENDERECO-CELULAR.bat`: mostra o endereço para abrir no celular conectado ao mesmo Wi-Fi.
- `PARAR-BRUTUS.bat`: encerra apenas o servidor do Brutu's.
- `DESINSTALAR-BRUTUS.bat`: remove o programa e pergunta separadamente se os dados também devem ser apagados.

## Impressão

Ative **Impressão automática** no painel. O QZ Tray e a impressora precisam estar ligados. O sistema reserva cada pedido antes de imprimir para evitar duplicidade.

## Atualizações

Executar um instalador novo não apaga o banco nem os backups existentes. Mesmo assim, faça um backup manual antes de grandes atualizações.

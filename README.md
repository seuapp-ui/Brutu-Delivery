# Brutu's Delivery — Cardápio Digital

Cardápio digital de página única (PWA). O cliente abre um link, monta o
pedido e, ao finalizar, o app abre o WhatsApp do restaurante com a mensagem
do pedido já pronta. **Sem login, sem cadastro, sem painel administrativo,
sem servidor e sem banco de dados** — tudo roda no navegador do cliente.

## Estrutura do projeto

```
brutus-delivery/
├── index.html          → estrutura da página (não precisa mexer aqui no dia a dia)
├── manifest.json        → configuração do PWA (nome, ícone, cores)
├── sw.js                 → Service Worker (faz o app funcionar offline)
├── css/
│   └── style.css         → visual do cardápio
├── js/
│   └── app.js            → toda a lógica (carrinho, checkout, mensagem do WhatsApp)
├── data/
│   └── menu.json         → ★ ARQUIVO QUE VOCÊ EDITA NO DIA A DIA ★
├── icons/                → ícones do app (tela inicial do celular)
└── extra/
    └── imprimir-pedido.html → ferramenta para imprimir os pedidos recebidos no WhatsApp
```

## Modo atual: teste local com duplo clique

Por enquanto o projeto está configurado para abrir **direto com duplo
clique no `index.html`**, sem precisar de servidor — ótimo para testar
rápido. Para isso funcionar, o cardápio é carregado a partir de
`data/menu-data.js` (é o mesmo conteúdo de `data/menu.json`, só que
"embrulhado" em JavaScript, porque os navegadores bloqueiam por segurança
a leitura de arquivos `.json` locais quando a página é aberta via duplo
clique).

**➜ Durante os testes, edite `data/menu-data.js`.** A estrutura interna é
idêntica à do `menu.json` descrita abaixo — só ignore a primeira linha
(comentário) e o `window.MENU_DATA = ` no início do arquivo.

Quando você for publicar o site de verdade (GitHub Pages, Netlify etc.),
o app volta a funcionar também via `fetch` de `data/menu.json`
automaticamente (o código já detecta se está rodando local ou hospedado).
Nessa hora, é só me pedir para gerar o `menu-data.js` novamente a partir do
`menu.json` mais atual, ou manter os dois arquivos iguais.

## O que editar no dia a dia: `data/menu.json` (referência dos campos)

Todo o conteúdo do cardápio segue este formato — vale tanto para o
`menu.json` quanto para o `menu-data.js`.

### 1. Número do WhatsApp do restaurante

```json
"whatsapp": "5516999999999"
```

Formato: código do país (55) + DDD + número, **só números, sem espaços,
traços ou parênteses**. É para esse número que todos os pedidos serão
enviados.

### 2. Dados gerais do restaurante

```json
"restaurante": {
  "nome": "Brutu's Delivery",
  "slogan": "Burger de peso, sabor de sobra.",
  "logo": "icons/icon-512.png",
  "banner": "https://... (imagem do banner promocional)",
  "bannerTexto": "COMBO DA SEMANA · a partir de R$ 34,90",
  "whatsapp": "5516999999999",
  "taxaEntrega": 6.0,
  "tempoEstimado": "35-50 min",
  "enderecoRetirada": "Rua das Brasas, 120 - Centro"
}
```

- `taxaEntrega`: valor fixo cobrado quando o cliente escolhe "Entrega". Na
  retirada esse valor não é cobrado.
- `enderecoRetirada`: endereço mostrado/enviado quando o cliente escolhe
  "Retirar no local".

### 2.1 Horário de funcionamento

```json
"horario": {
  "abre": "18:00",
  "fecha": "23:59",
  "diasFechado": [1]
}
```

O status "Aberto agora" / "Fechado no momento" no topo do site é calculado
automaticamente a partir deste horário (e atualiza sozinho a cada minuto).
`diasFechado` usa `0` = domingo, `1` = segunda ... `6` = sábado.

### 3. Categorias

```json
"categorias": [
  { "id": "hamburgueres", "nome": "Hambúrgueres", "icone": "🍔" }
]
```

O `id` é usado para ligar os produtos à categoria — se criar uma categoria
nova, use um `id` novo e use esse mesmo texto no campo `categoria` dos
produtos daquela seção.

### 4. Adicionais (extras que aparecem em vários produtos)

```json
"adicionaisDisponiveis": [
  { "id": "add-bacon", "nome": "Bacon extra", "preco": 6.0 }
]
```

Cadastre aqui os adicionais uma única vez. Depois, em cada produto, você só
faz referência ao `id` dele (veja abaixo).

### 5. Produtos

```json
{
  "id": "p001",
  "categoria": "hamburgueres",
  "nome": "X-Brutu",
  "descricao": "Pão brioche, carne 180g, queijo prato...",
  "foto": "https://link-da-foto.jpg",
  "preco": 24.9,
  "ingredientes": ["Pão brioche", "Carne 180g", "Queijo prato"],
  "adicionais": ["add-bacon", "add-cheddar"],
  "destaque": true
}
```

- `id`: único para cada produto (não repita).
- `categoria`: precisa bater com o `id` de uma categoria.
- `foto`: link direto de uma imagem (pode ser uma URL de qualquer imagem
  hospedada — Imgur, seu próprio site, etc.).
- `ingredientes`: lista só informativa, aparece na tela de detalhe.
- `adicionais`: lista de `id`s vindos de `adicionaisDisponiveis`. Deixe `[]`
  se o produto não tiver adicionais.
- `destaque`: `true` mostra o selo "TOP" no card do produto.

Para adicionar um produto novo, copie um bloco existente, cole antes do `]`
final da lista `produtos`, e ajuste os campos. Para remover, apague o bloco
inteiro (cuidado para não deixar vírgula sobrando).

> Dica: qualquer editor de texto serve (Bloco de Notas, VS Code etc.), mas
> um site como [jsonlint.com](https://jsonlint.com) ajuda a checar se o
> arquivo continua um JSON válido antes de publicar.

## Como o pedido chega no WhatsApp

Ao clicar em **Enviar pedido pelo WhatsApp**, o app monta uma mensagem
formatada (cliente, endereço, itens, adicionais, observações, forma de
pagamento e total) e abre `https://wa.me/<numero>?text=...` — o WhatsApp
Web ou o app do celular abre já com a mensagem escrita, e o cliente só
precisa apertar enviar.

Quando a forma de pagamento é "Dinheiro", o cliente informa quanto vai
pagar e o app calcula o troco automaticamente (com base no total do
pedido), mostrando o valor na tela antes de enviar e incluindo tanto o
valor pago quanto o troco na mensagem do WhatsApp.

## Imprimindo os pedidos que chegam no WhatsApp

O WhatsApp é uma plataforma fechada — não é possível colocar um botão de
"imprimir" dentro do próprio WhatsApp (isso só seria possível com a API
oficial do WhatsApp Business, que exige aprovação da Meta e uma
integração bem mais complexa, fora do escopo deste projeto).

Como alternativa prática, o arquivo `extra/imprimir-pedido.html` é uma
ferramenta simples e independente: o restaurante cola o texto do pedido
copiado do WhatsApp numa caixa, clica em **Imprimir pedido**, e a página
abre a tela de impressão já formatada como um cupom, sem os asteriscos de
negrito do WhatsApp. Funciona offline, sozinha, sem precisar do cardápio
nem de internet.

## Publicando o link (sem servidor próprio)

Como é tudo estático (HTML/CSS/JS), você pode hospedar de graça em:

- **GitHub Pages** — suba a pasta para um repositório e ative o Pages.
- **Netlify / Vercel** — arraste a pasta do projeto no painel deles.
- Qualquer hospedagem simples que sirva arquivos estáticos.

Depois é só compartilhar o link pelo WhatsApp, redes sociais, etc.

⚠️ Importante para o PWA/offline funcionar: o site precisa ser servido via
**HTTPS** (ou `localhost` durante testes) — Service Worker não funciona em
`http://` comum.

## Testando localmente (opcional)

Como explicado no início, dá para testar só com duplo clique no
`index.html` (o app usa `data/menu-data.js` automaticamente nesse caso).
Se quiser testar especificamente o comportamento "hospedado" (buscando
`data/menu.json` via `fetch`, incluindo o modo offline do PWA), rode um
servidor local simples, por exemplo:

```bash
# Python 3
python3 -m http.server 8080

# depois acesse:
http://localhost:8080
```

## Estrutura preparada para crescer

O `app.js` é comentado por seções (config, estado, carregamento, render,
modal, carrinho, checkout, mensagem, PWA, inicialização) para facilitar
incluir futuramente, por exemplo: cupons de desconto, horário de
funcionamento automático, múltiplas unidades, ou integração com um painel
administrativo — sem precisar reescrever o que já existe.

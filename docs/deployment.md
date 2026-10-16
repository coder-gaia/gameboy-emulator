# Preparação da publicação

A preparação para hospedar o Pocket Lab como arquivos estáticos está concluída. **A publicação pública está pendente da criação e conexão da conta Cloudflare do proprietário.** Ainda não existe uma URL pública verificada. A hospedagem prevista continua sendo Cloudflare Pages Free.

O visitante não precisa de conta. ROMs próprias, bateria e estados ficam no navegador. O deploy publica somente a interface, o Worker, o AudioWorklet, fontes locais, demos autorizadas e seus créditos. Não há backend, Pages Functions, serviço pago ou upload de ROM.

## Validar o mesmo build que será publicado

Na raiz do projeto, com as dependências instaladas:

```powershell
npm.cmd run build
node scripts/serve-production.mjs --port 4174
```

Abra `http://127.0.0.1:4174/`. Esse endereço é local e não constitui uma publicação. Encerre o servidor com `Ctrl+C`.

O servidor de QA entrega `dist`, aplica as regras de `dist/_headers` e utiliza os tipos MIME necessários a JavaScript, CSS, fontes e ROMs. Atende apenas GET e HEAD, em `127.0.0.1`. Aceita `--port 4190` ou `--port=4190`; sem argumento usa 4174. Arquivos ausentes retornam 404, inclusive ROMs, sem substituir o arquivo por HTML. Não lista diretórios e bloqueia caminhos que saiam do build, symlinks externos, arquivos ocultos e arquivos de controle.

Importar `scripts/serve-production.mjs` disponibiliza `parseHeaders`, `headersForPath` e `createProductionServer` sem abrir uma porta. O parser implementa o subconjunto utilizado neste projeto: caminhos locais exatos ou com um único asterisco. Sintaxe de Cloudflare não suportada provoca erro explícito. Esse servidor existe para QA local; não substitui a infraestrutura de produção da Cloudflare nem reproduz seu CDN, compressão ou distribuição geográfica.

Confira no build local:

1. Os dois jogos abrem e suas ROMs passam pela validação SHA-256.
2. O jardim executa, responde a teclado e toque e pausa ao ocultar a aba.
3. **Ativar som** reproduz áudio; volume, mute, pausa e retomada continuam funcionando.
4. Bateria e slots persistem; exportar e importar `.pocketstate` funciona.
5. O console do navegador não registra violações de CSP nem falhas de Worker ou AudioWorklet.
6. As requisições de recursos permanecem no mesmo endereço do site. Links de créditos externos só são abertos quando escolhidos pelo visitante.

## Conectar Cloudflare Pages Free

O proprietário precisa criar uma conta Free e entrar no [painel Cloudflare](https://dash.cloudflare.com/). A instalação do GitHub App autoriza a conexão do repositório. Não envie senha, token ou código de autenticação pelo chat. O fluxo pelo painel dispensa Wrangler e tokens locais.

1. Em **Workers & Pages**, escolha **Create application**, **Pages** e **Connect to Git**. Dependendo da versão do painel, a opção aparece como **Import an existing Git repository**.
2. Conecte GitHub e limite o acesso do aplicativo ao repositório `coder-gaia/gameboy-emulator`.
3. Selecione esse repositório e prossiga para a configuração do build.
4. Use os valores abaixo, sem adicionar Functions ou bindings.
5. Confirme os checks do commit que será publicado e escolha **Save and Deploy**.
6. Aguarde o build terminar. Compartilhe a URL gerada e o commit associado para permitir a validação pública. O nome do projeto pode estar indisponível; não é possível prometer antecipadamente um subdomínio específico.

| Campo                  | Valor                                |
| ---------------------- | ------------------------------------ |
| Plano                  | Free                                 |
| Production branch      | `main`                               |
| Framework preset       | React (Vite)                         |
| Build command          | `npm run build`                      |
| Build output directory | `dist`                               |
| Root directory         | Raiz do repositório, campo vazio     |
| Node                   | `22.13.0`, fixado em `.node-version` |

Se o painel exigir configuração explícita de Node, use `NODE_VERSION=22.13.0`. O pin corresponde ao ambiente local utilizado pelo projeto e satisfaz o mínimo de Vite. Atualizações de Node devem passar novamente pelos checks. Não dependa somente de `package.json.engines`: o sistema de build v3 de Pages não detecta esse campo. [Configuração de build](https://developers.cloudflare.com/pages/configuration/build-configuration/), [versões do ambiente](https://developers.cloudflare.com/pages/configuration/build-image/).

A integração Git gera deploys a partir de novos pushes e permite previews. Ela possui uma pipeline própria e não espera automaticamente pelos checks do GitHub Actions. Confira os dois resultados quando houver publicação. [Integração Git](https://developers.cloudflare.com/pages/get-started/git-integration/), [permissões do GitHub App](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/).

## Cache e política do navegador

`public/_headers` acompanha o build. `/assets/*` recebe cache de um ano e `immutable`, pois Vite acrescenta hash aos nomes de JavaScript, CSS, Worker, Worklet e fontes. HTML e `/games/*` usam `max-age=0, must-revalidate`: os nomes dos cartuchos são estáveis e precisam conferir atualizações. O servidor local usa ETag para exercitar a revalidação. A Cloudflare mantém seu próprio mecanismo de ETag e pode comprimir a entrega. [Cabeçalhos customizados](https://developers.cloudflare.com/pages/configuration/headers/), [entrega estática](https://developers.cloudflare.com/pages/configuration/serving-pages/).

A CSP permite scripts, Worker, Worklet, fontes e fetch do próprio domínio. Não permite scripts inline nem `eval`. `style-src` aceita estilos inline porque as paletas usam propriedades CSS aplicadas por React. A política bloqueia plugins, formulários e incorporação por iframe. Os cabeçalhos também incluem `nosniff`, proteção contra enquadramento e política de referência. Câmera, microfone, localização, pagamentos e USB ficam desativados; gamepad e fullscreen permanecem disponíveis.

Não há SharedArrayBuffer e não é necessário ativar COOP ou COEP. O AudioWorklet continua dependendo de HTTPS ou localhost e de um clique em **Ativar som**. Hospedar arquivos estáticos remove o cold start de um processo de servidor. Download e inicialização no navegador continuam existindo e devem ser medidos no perfil documentado do projeto.

## Conferir a publicação real

Após receber uma URL pública, repita o roteiro no endereço HTTPS, confira os cabeçalhos das respostas e confirme que Worker, Worklet, fontes e demos não retornam HTML ou 404. Verifique o commit apresentado no painel. Meça abertura inicial com cache vazio separadamente da visita seguinte; uma simulação de celular no desktop não equivale a teste em aparelho físico.

Use o endereço estável do projeto para jogar e testar persistência. IndexedDB é separado por origem: localhost, previews, `pages.dev` e um domínio próprio possuem saves diferentes. Antes de trocar a origem, exporte os estados que desejar preservar. O projeto não transfere saves automaticamente entre esses endereços.

O Free admite 500 builds por mês, um build simultâneo, até 20 minutos por build, 20.000 arquivos e 25 MiB por arquivo. Requisições de arquivos estáticos são gratuitas e ilimitadas; Functions possuem regras próprias e não fazem parte deste projeto. [Limites de Pages](https://developers.cloudflare.com/pages/platform/limits/), [preços de recursos estáticos](https://developers.cloudflare.com/pages/functions/pricing/).

Uma publicação só será registrada como concluída depois que o deploy terminar e a URL real passar pelas verificações. Enquanto a conta estiver pendente, o build local e o repositório continuam prontos para revisão.

Para executar os mesmos testes no endereço HTTPS publicado:

```powershell
$env:POCKETLAB_PRODUCTION_URL = 'https://seu-projeto.pages.dev'
npm.cmd run test:production
Remove-Item Env:POCKETLAB_PRODUCTION_URL
```

Substitua o exemplo pela URL real do painel. Com essa variável, a suíte usa o site remoto e não inicia um servidor local.

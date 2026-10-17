# Publicação no Cloudflare Pages

A beta está publicada em **[gameboy-emulator-aox.pages.dev](https://gameboy-emulator-aox.pages.dev/)**. O proprietário realizou a publicação inicial da M10, e o endereço HTTPS passou pela validação real em 16 de outubro de 2026, no fuso America/Sao_Paulo. A integração Git atualiza o site a cada push em `main`; confira o deploy e a build correspondente a cada entrega.

Os dez testes de produção passaram no endereço público, em desktop e perfil Pixel 7 simulado. Foram exercitados os dois jogos com hashes conferidos, Worker, áudio real no AudioWorklet, slots, reload, importação e exportação de arquivos, remapeamento e tela cheia. Não houve erros de navegador, violações CSP ou requisições da aplicação a terceiros. Essa emulação de navegador não comprova funcionamento em um aparelho Pixel 7 físico.

HTML e assets públicos corresponderam aos SHA-256 da build medida na M10: entrada `index-De27AeGu.js`, CSS `index-yAd_Awak.css`, Worker `emulator.worker-BeJo7_Rn.js` e Worklet `pcm-worklet-C6AScAOB.js`. Os hashes completos permanecem em [resultados de desempenho do navegador](performance-browser-results.json). Os cabeçalhos reais conferiram CSP, `nosniff`, `DENY`, política de permissões e de recursos, revalidação de HTML e cache imutável dos assets.

O visitante não precisa de conta. ROMs próprias, bateria e estados ficam no navegador. O deploy publica somente a interface, o Worker, o AudioWorklet, fontes locais, demos autorizadas e seus créditos. Não há backend, Pages Functions, serviço pago ou upload de ROM.

A M11 acrescenta rewind e o fundo creme. Seu build final passou pelos 14 testes de produção locais, incluindo volta da imagem e da CPU, suspensão do áudio durante o gesto e retomada de PCM real sob CSP. Os nomes dos assets mudam com o conteúdo; a lista acima registra a publicação inicial da M10, e não deve ser usada como identificação fixa das próximas versões.

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

## Configuração e referência para outra publicação

O site já está publicado. Os passos abaixo ficam como referência para conferir a configuração ou criar outra publicação no [painel Cloudflare](https://dash.cloudflare.com/). A instalação do GitHub App autoriza a conexão do repositório. O fluxo pelo painel dispensa Wrangler e tokens locais.

1. Em **Workers & Pages**, escolha **Create application**, **Pages** e **Connect to Git**. Dependendo da versão do painel, a opção aparece como **Import an existing Git repository**.
2. Conecte GitHub e limite o acesso do aplicativo ao repositório `coder-gaia/gameboy-emulator`.
3. Selecione esse repositório e prossiga para a configuração do build.
4. Use os valores abaixo, sem adicionar Functions ou bindings.
5. Confirme os checks do commit que será publicado e escolha **Save and Deploy**.
6. Aguarde o build terminar e valide a URL gerada contra o commit publicado. O projeto atual usa `gameboy-emulator-aox.pages.dev`; outra publicação pode receber um endereço diferente.

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

A publicação da M10 foi validada no endereço HTTPS real. Após cada novo deploy, repita o roteiro, confira os cabeçalhos das respostas e confirme que Worker, Worklet, fontes e demos não retornam HTML ou 404. Verifique o commit apresentado no painel. Meça abertura inicial com cache vazio separadamente da visita seguinte; uma simulação de celular no desktop não equivale a teste em aparelho físico.

Use o endereço estável do projeto para jogar e testar persistência. IndexedDB é separado por origem: localhost, previews, `pages.dev` e um domínio próprio possuem saves diferentes. Antes de trocar a origem, exporte os estados que desejar preservar. O projeto não transfere saves automaticamente entre esses endereços.

O Free admite 500 builds por mês, um build simultâneo, até 20 minutos por build, 20.000 arquivos e 25 MiB por arquivo. Requisições de arquivos estáticos são gratuitas e ilimitadas; Functions possuem regras próprias e não fazem parte deste projeto. [Limites de Pages](https://developers.cloudflare.com/pages/platform/limits/), [preços de recursos estáticos](https://developers.cloudflare.com/pages/functions/pricing/).

A M10 está registrada como concluída e publicada. Novas entregas só recebem essa confirmação depois que o deploy correspondente terminar e o endereço real passar pelas verificações.

Para executar os mesmos testes no endereço HTTPS publicado:

```powershell
$env:POCKETLAB_PRODUCTION_URL = 'https://gameboy-emulator-aox.pages.dev'
try {
  npm.cmd run test:production -- --workers=2
} finally {
  Remove-Item Env:\POCKETLAB_PRODUCTION_URL -ErrorAction SilentlyContinue
}
```

Com essa variável, a suíte usa o site remoto e não inicia um servidor local. Execute depois de confirmar o deploy do commit da M11: são 14 casos, incluindo rewind e áudio. Os dados criados pelos testes ficam nos perfis isolados do Playwright.

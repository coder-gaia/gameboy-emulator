# Pocket Lab

Um emulador de Game Boy DMG no navegador, com núcleo TypeScript independente da interface.

Projeto em desenvolvimento. A execução de jogos, o vídeo e o áudio ainda não estão disponíveis.

## Desenvolvimento local

Requer Node.js 22.12 ou superior e npm.

```sh
npm ci
npm run dev
```

Abra o endereço mostrado no terminal. No PowerShell com execução de scripts desabilitada, use `npm.cmd` no lugar de `npm`.

```sh
npm run check
npm run test:e2e
```

Os testes de navegador precisam do Chromium do Playwright: `npx playwright install chromium`.

## Arquitetura

Um repositório e um pacote npm, sem monorepo. React e Vite compõem a interface. O núcleo em `src/core` não conhece o navegador, trabalha em T-cycles e terá testes executados em Node.

Canvas 2D, Web Worker, AudioWorklet e IndexedDB serão introduzidos nas milestones correspondentes. O destino de publicação é Cloudflare Pages Free, como site estático.

## Planejamento

O [plano original](plano-emulador-gameboy.md) preserva a proposta inicial. O [roteiro de milestones](docs/milestones.md) registra o plano aprovado e o estado real.

## Conteúdo de terceiros

Não há ROM de jogo ou boot ROM distribuída neste estágio. As fontes DM Sans e Space Mono são fornecidas localmente pelos pacotes Fontsource. Consulte [créditos e licenças](docs/third-party.md).

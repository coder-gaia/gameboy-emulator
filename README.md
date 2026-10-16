# Pocket Lab

Um emulador de Game Boy DMG no navegador, com núcleo TypeScript independente da interface.

Projeto em desenvolvimento. O carregamento local e a inspeção de cartuchos já estão disponíveis. A execução de jogos, o vídeo e o áudio ainda não estão disponíveis.

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

## Cartuchos e testes atuais

Selecione um arquivo `.gb` ou `.gbc`, ou arraste-o para a página. Os bytes são lidos localmente e não são enviados. O header informa título, controlador, ROM, RAM e bateria. ROMs que exigem Game Boy Color e controladores futuros são identificados sem prometer suporte de execução.

O bus implementa ROM Only, memória de trabalho, echo RAM, VRAM, OAM, HRAM e interrupções de serial. A transferência serial interna leva 4096 T-cycles por byte. Timers, DMA, PPU e APU ainda estão pendentes.

`npm test` executa fixtures sintéticas próprias, incluindo validação de headers, memória, serial e limites do runner. Nenhuma suíte externa de ROMs foi executada neste estágio.

## Planejamento

O [plano original](plano-emulador-gameboy.md) preserva a proposta inicial. O [roteiro de milestones](docs/milestones.md) registra o plano aprovado e o estado real.

## Conteúdo de terceiros

Não há ROM de jogo ou boot ROM distribuída neste estágio. As fontes DM Sans e Space Mono são fornecidas localmente pelos pacotes Fontsource. Consulte [créditos e licenças](docs/third-party.md).

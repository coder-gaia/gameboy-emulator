# Pocket Lab

Um emulador de Game Boy DMG no navegador, com núcleo TypeScript independente da interface.

Projeto em desenvolvimento. O carregamento local, a inspeção de cartuchos e a execução manual da CPU já estão disponíveis. Vídeo, áudio e reprodução completa de jogos ainda estão em preparação.

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

## Testar o primeiro grupo de milestones

1. Execute `npm run dev` e abra o endereço exibido.
2. Troque entre DMG, Pocket e Light e confira o layout no desktop e celular.
3. Clique em **Experimentar cartucho de diagnóstico**. O header deve mostrar POCKET TEST, ROM Only, 32 KiB de ROM e 0 KiB de RAM.
4. Abra **Inspecionar CPU**. Uma instrução muda PC de 0100 para 0150.
5. Clique em **Até 1000 instruções**. A ROM própria termina em HALT, com PC 017D e saída serial OK.
6. Clique em **Reiniciar CPU**. PC volta a 0100, ciclos a zero e a serial é limpa.
7. Opcionalmente, selecione ou arraste um arquivo `.gb` próprio. Cartuchos truncados geram erro e controladores futuros são identificados.

A CPU implementa todas as instruções base válidas e as 256 instruções CB, com testes de aritmética, flags, saltos, pilha, ordem de acessos e snapshots. Os opcodes inválidos geram diagnóstico em vez de serem tratados como NOP.

Os registradores da CPU usam inicialização pós boot DMG, incluindo F dependente do checksum do header. Os periféricos ainda não têm inicialização pós boot completa. STOP tem comportamento básico e interrupções ainda não cobrem corridas durante o atendimento. Esses pontos serão aprofundados nas próximas milestones.

Há uma limitação conhecida a resolver na M03: `EI;HALT` com interrupção já pendente precisa ajustar o endereço de retorno ao HALT. O atendimento atual usa o PC seguinte. A validação de timing por suítes externas permanece pendente.

Esta é a pausa após M00, M01 e M02. M03 ainda não foi iniciada.

## Planejamento

O [plano original](plano-emulador-gameboy.md) preserva a proposta inicial. O [roteiro de milestones](docs/milestones.md) registra o plano aprovado e o estado real.

## Conteúdo de terceiros

Não há ROM de jogo ou boot ROM distribuída neste estágio. As fontes DM Sans e Space Mono são fornecidas localmente pelos pacotes Fontsource. Consulte [créditos e licenças](docs/third-party.md).

# Pocket Lab

Um emulador de Game Boy DMG no navegador, com núcleo TypeScript independente da interface.

Projeto em desenvolvimento. Carregamento local, CPU, timer, DMA e vídeo de fundo já estão disponíveis. O jardim de teste é uma ROM própria executada pela máquina. Sprites, janela, controles e áudio entram nas próximas etapas.

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

Canvas 2D apresenta o framebuffer de 160 por 144 pixels. A cadência sem áudio usa tempo monotônico e um orçamento de ciclos, independentemente da frequência do monitor. Web Worker, AudioWorklet e IndexedDB serão introduzidos nas milestones correspondentes. O destino de publicação é Cloudflare Pages Free, como site estático.

## Cartuchos e testes atuais

Selecione um arquivo `.gb` ou `.gbc`, ou arraste-o para a página. Os bytes são lidos localmente e não são enviados. O header informa título, controlador, ROM, RAM e bateria. ROMs que exigem Game Boy Color e controladores futuros são identificados sem prometer suporte de execução.

O bus implementa ROM Only, memória de trabalho, echo RAM, VRAM, OAM, HRAM, timer, DMA de OAM, interrupções e PPU. A transferência serial interna leva 4096 T-cycles por byte. A PPU implementa fundo, tiles, scroll, modos, LY/LYC e STAT. APU, sprites e janela ainda estão pendentes.

`npm test` executa fixtures sintéticas próprias, incluindo headers, memória, serial, CPU, timer, DMA, PPU e cadência. `npm run test:hardware` executa 62 ROMs externas fixadas por revisão e SHA-256. Consulte [procedência e protocolos](docs/test-roms.md).

| Suíte                                        | Resultado atual |
| -------------------------------------------- | --------------- |
| Blargg cpu_instrs individuais                | 11 de 11        |
| Blargg instr_timing                          | 1 de 1          |
| Blargg mem_timing individuais                | 3 de 3          |
| Mooneye, seleção DMG da M03                  | 27 de 27        |
| Mooneye, acessos sincronizados ao LCD da M04 | 20 de 20        |

As ROMs Blargg são baixadas para uma pasta ignorada. O runner usa um adapter de cartucho de teste MBC1 limitado a 32 KiB, preservando os binários originais. Isso não habilita MBC1 na aplicação. As fixtures Mooneye preservam a licença MIT.

## Testar o primeiro grupo de milestones

1. Execute `npm run dev` e abra o endereço exibido.
2. Troque entre DMG, Pocket e Light e confira o layout no desktop e celular.
3. Clique em **Experimentar cartucho de diagnóstico**. O header deve mostrar POCKET TEST, ROM Only, 32 KiB de ROM e 0 KiB de RAM.
4. Abra **Inspecionar CPU**. Uma instrução muda PC de 0100 para 0150.
5. Clique em **Até 1000 instruções**. A ROM própria termina em HALT, com PC 017D e saída serial OK.
6. Clique em **Reiniciar CPU**. PC volta a 0100, ciclos a zero e a serial é limpa.
7. Opcionalmente, selecione ou arraste um arquivo `.gb` próprio. Cartuchos truncados geram erro e controladores futuros são identificados.

A CPU implementa todas as instruções base válidas e as 256 instruções CB, com testes de aritmética, flags, saltos, pilha, ordem de acessos e snapshots. Os opcodes inválidos geram diagnóstico em vez de serem tratados como NOP.

Os registradores da CPU usam inicialização pós boot DMG, incluindo F dependente do checksum do header. Os periféricos ainda não têm inicialização pós boot completa. STOP tem comportamento básico, com reset do divisor, e a plataforma conectará a entrada do joypad na M05.

A M03 corrige `EI;HALT` com interrupção pendente e a resseleção de interrupção quando a pilha escreve sobre IE. Os testes externos não representam aprovação de todos os comportamentos de todas as revisões do hardware.

O primeiro grupo foi aprovado. O grupo atual contém M03, M04 e M05, com a próxima pausa antes da M06.

## Vídeo e reprodução

Clique em **Explorar jardim** para abrir POCKET GARDEN. O cenário de quatro tons se desloca horizontalmente, gerado por instruções SM83, tiles e mapa de fundo reais. **Pausar** congela a máquina; **Iniciar** retoma; **Reiniciar** volta ao começo em pausa. Trocar a paleta altera a tela sem reiniciar o cartucho.

A execução pausa quando a aba fica oculta. O botão Iniciar retoma sem tentar recuperar todo o tempo acumulado. O painel de CPU observa a mesma máquina do Canvas; comandos manuais exigem pausa.

A PPU usa renderização por scanline e não modela pixel FIFO nem alterações de registradores dentro do modo 3. A escala considera pixels físicos e a densidade da tela, com suavização desabilitada.

## Planejamento

O [plano original](plano-emulador-gameboy.md) preserva a proposta inicial. O [roteiro de milestones](docs/milestones.md) registra o plano aprovado e o estado real.

## Conteúdo de terceiros

Não há ROM de jogo ou boot ROM distribuída neste estágio. As fontes DM Sans e Space Mono são fornecidas localmente pelos pacotes Fontsource. Consulte [créditos e licenças](docs/third-party.md).

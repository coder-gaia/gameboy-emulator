# Pocket Lab

Um emulador de Game Boy DMG no navegador, com núcleo TypeScript independente da interface.

Projeto em desenvolvimento, com M00 a M05 concluídas. CPU, timer, DMA, vídeo, sprites, janela e controles já estão disponíveis. O jardim interativo é uma ROM própria executada pela máquina, sem precisar obter um jogo. Áudio, saves e a demo Tobu Tobu Girl entram nas próximas etapas.

## Desenvolvimento local

Requer Node.js 22.12 ou superior e npm.

```powershell
npm.cmd ci
npm.cmd run dev
```

Abra o endereço mostrado no terminal. Os exemplos usam `npm.cmd` para funcionar também no PowerShell com execução de scripts desabilitada. Em outros shells, use `npm`.

```powershell
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run test:hardware
```

Os testes de navegador precisam do Chromium do Playwright: `npx.cmd playwright install chromium`. O comando de hardware prepara as ROMs externas, confere seus hashes e executa as suítes de timing e a comparação gráfica.

## Arquitetura

Um repositório e um pacote npm, sem monorepo. React e Vite compõem a interface. O núcleo em `src/core` não conhece o navegador, trabalha em T-cycles e tem testes executados em Node.

Canvas 2D apresenta o framebuffer de 160 por 144 pixels. A cadência sem áudio usa tempo monotônico e um orçamento de ciclos, independentemente da frequência do monitor. Web Worker, AudioWorklet e IndexedDB serão introduzidos nas milestones correspondentes. O destino de publicação é Cloudflare Pages Free, como site estático.

## Cartuchos e testes atuais

Use **Explorar jardim** para testar sem arquivo. Para carregar um jogo próprio, selecione um arquivo `.gb` ou `.gbc`, ou arraste-o para a página. Os bytes são lidos localmente e não são enviados. A ajuda **Quais arquivos posso usar?** explica formatos, extração de `.zip` e compatibilidade.

A execução aceita cartuchos **ROM Only de 32 KiB** compatíveis com o Game Boy original. Arquivos `.gbc` precisam funcionar também no DMG. Jogos exclusivos de Game Boy Color e cartuchos MBC1, MBC2, MBC3 ou MBC5 podem ter seus dados consultados, mas ainda não executam. O limite de leitura é 8 MiB. Não é necessário fornecer BIOS ou boot ROM.

O bus implementa memória de trabalho, echo RAM, VRAM, OAM, HRAM, timer, DMA de OAM, interrupções, joypad e PPU. A transferência serial interna leva 4096 T-cycles por byte. A PPU implementa fundo, tiles, scroll, modos, LY/LYC, STAT, sprites e janela. APU e persistência ainda estão pendentes.

`npm.cmd test` executa fixtures próprias de núcleo, entrada e reprodução. `npm.cmd run test:hardware` executa 62 ROMs de instruções e timing, mais dmg-acid2, com revisão e SHA-256 fixados. Consulte [procedência e protocolos](docs/test-roms.md).

| Suíte                                        | Resultado atual |
| -------------------------------------------- | --------------- |
| Blargg cpu_instrs individuais                | 11 de 11        |
| Blargg instr_timing                          | 1 de 1          |
| Blargg mem_timing individuais                | 3 de 3          |
| Mooneye, seleção DMG da M03                  | 27 de 27        |
| Mooneye, acessos sincronizados ao LCD da M04 | 20 de 20        |
| dmg-acid2, comparação gráfica DMG            | 1 de 1          |

As ROMs Blargg são baixadas para uma pasta ignorada. O runner usa um adapter de cartucho de teste MBC1 limitado a 32 KiB, preservando os binários originais. Isso não habilita MBC1 na aplicação. As fixtures Mooneye preservam a licença MIT.

## Testar o primeiro grupo de milestones

1. Execute `npm.cmd run dev` e abra o endereço exibido.
2. Troque entre DMG, Pocket e Light e confira o layout no desktop e celular.
3. Clique em **Experimentar cartucho de diagnóstico**. O header deve mostrar POCKET TEST, ROM Only, 32 KiB de ROM e 0 KiB de RAM.
4. Abra **Inspecionar CPU**. Uma instrução muda PC de 0100 para 0150.
5. Clique em **Até 1000 instruções**. A ROM própria termina em HALT, com PC 017D e saída serial OK.
6. Clique em **Reiniciar CPU**. PC volta a 0100, ciclos a zero e a serial é limpa.
7. Opcionalmente, selecione ou arraste um arquivo `.gb` próprio. Cartuchos truncados geram erro e controladores futuros são identificados.

A CPU implementa todas as instruções base válidas e as 256 instruções CB, com testes de aritmética, flags, saltos, pilha, ordem de acessos e snapshots. Os opcodes inválidos geram diagnóstico em vez de serem tratados como NOP.

Os registradores da CPU usam inicialização pós boot DMG, incluindo F dependente do checksum do header. A inicialização completa de todas as revisões de hardware permanece fora da validação atual. STOP suspende o clock, redefine o divisor e retoma após uma borda de entrada do joypad.

A M03 corrige `EI;HALT` com interrupção pendente e a resseleção de interrupção quando a pilha escreve sobre IE. Os testes externos não representam aprovação de todos os comportamentos de todas as revisões do hardware.

O primeiro grupo foi aprovado. O segundo grupo, M03, M04 e M05, está concluído e aguarda o teste do proprietário antes da M06. Siga o [roteiro de teste com resultados esperados](docs/testing-m03-m05.md).

## Vídeo e reprodução

Clique em **Explorar jardim** para abrir POCKET GARDEN. O cenário de quatro tons permanece parado na M05. Um personagem original de 8 por 16 pixels pode passear pelo jardim; a legenda inferior usa a janela do Game Boy. Tudo é produzido por instruções SM83, tiles, mapas e OAM reais.

| Entrada                        | Efeito no jardim                                         |
| ------------------------------ | -------------------------------------------------------- |
| Setas ou direcional do console | Move o personagem, inclusive em diagonal                 |
| Z ou botão A                   | Alterna a aparência uma vez por pressionamento           |
| X ou botão B                   | Volta à posição inicial                                  |
| Enter e Shift                  | Enviam Start e Select; o jardim não atribui ações a eles |

Os botões do console funcionam por toque ou ponteiro. **Pausar** congela a máquina; **Iniciar** retoma; **Reiniciar** volta ao começo em pausa. Trocar a paleta altera a tela sem reiniciar o cartucho. Abrir a ajuda também pausa a reprodução.

A execução pausa quando a aba fica oculta. O botão Iniciar retoma sem tentar recuperar todo o tempo acumulado. O painel de CPU observa a mesma máquina do Canvas; comandos manuais exigem pausa.

A PPU usa renderização por scanline e não modela pixel FIFO, alterações de registradores dentro do modo 3 ou as peculiaridades de janela em WX 0 e 166. dmg-acid2 coincide com os 23.040 pixels oficiais, mas isso não comprova precisão completa do PPU. A escala considera pixels físicos e a densidade da tela, com suavização desabilitada.

## Planejamento

O [plano original](plano-emulador-gameboy.md) preserva a proposta inicial. O [roteiro de milestones](docs/milestones.md) registra o plano aprovado e o estado real.

## Conteúdo de terceiros

Não há jogo comercial ou boot ROM distribuídos. POCKET TEST e POCKET GARDEN, incluindo cenário, personagem e letras, são criações próprias. As ROMs externas ficam restritas aos testes. As fontes DM Sans e Space Mono são fornecidas localmente pelos pacotes Fontsource. Consulte [créditos e licenças](docs/third-party.md).

# Pocket Lab

Um emulador de Game Boy DMG no navegador, com núcleo TypeScript independente da interface.

Projeto em desenvolvimento, com M00 a M07 concluídas. CPU, timer, DMA, vídeo, sprites, janela, controles, MBC1, saves de bateria e áudio já estão disponíveis. A biblioteca oferece Tobu Tobu Girl e 2048 para jogar sem fornecer arquivos. O jardim interativo continua disponível como ROM própria de diagnóstico. Save states versionados e slots pertencem à M08, ainda pendente.

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

O Web Worker possui a máquina `GameBoy` e executa todas as instruções. A interface mantém cópias para apresentação no Canvas 2D de 160 por 144 pixels e para inspeção da CPU. Sem som, o Worker usa tempo monotônico e um orçamento de ciclos, independentemente da frequência do monitor. Com som, o AudioWorklet solicita PCM ao Worker por MessageChannel e controla a cadência. A implementação usa mensagens e buffers transferíveis, sem SharedArrayBuffer ou exigência de COOP/COEP.

IndexedDB armazena a RAM de bateria localmente, identificada pelo SHA-256 da ROM. O destino de publicação é Cloudflare Pages Free, como site estático. Consulte a [arquitetura de áudio e execução](docs/audio-runtime.md).

## Cartuchos e testes atuais

Escolha **Tobu Tobu Girl** ou **2048** na biblioteca para começar sem arquivo. **Controles e créditos dos jogos** explica as ações e apresenta os autores e as licenças. Use **Explorar jardim** para abrir o diagnóstico visual. Para carregar um jogo próprio, selecione um arquivo `.gb` ou `.gbc`, ou arraste-o para a página. Os bytes são lidos localmente e não são enviados. A ajuda **Quais arquivos posso usar?** explica formatos, extração de `.zip` e compatibilidade.

A execução aceita cartuchos **ROM Only de 32 KiB** e **MBC1 de até 2 MiB** compatíveis com o Game Boy original. MBC1 inclui bancos de ROM e RAM, ambos os modos de banking e habilitação de RAM. ROMs de até 512 KiB admitem até 32 KiB de RAM; ROMs de 1 MiB ou 2 MiB admitem até 8 KiB, conforme a fiação padrão. O tamanho de ROM precisa ser uma potência de dois. A convenção homebrew de RAM de 2 KiB é aceita com aviso, incluindo o 2048 da biblioteca.

Compilações **MBC1M** usam outra fiação e ficam fora do escopo atual. Não há autodetecção de MBC1M, cujo header também pode declarar MBC1. Arquivos `.gbc` precisam funcionar também no DMG. Jogos exclusivos de Game Boy Color e cartuchos MBC2, MBC3 ou MBC5 podem ter seus dados consultados, mas ainda não executam. O limite de leitura é 8 MiB. Não é necessário fornecer BIOS ou boot ROM.

O bus implementa memória de trabalho, echo RAM, VRAM, OAM, HRAM, timer, DMA de OAM, interrupções, joypad, PPU e APU. A transferência serial interna leva 4096 T-cycles por byte. A PPU implementa fundo, tiles, scroll, modos, LY/LYC, STAT, sprites e janela. A APU implementa dois canais de pulso, wave e noise, com sweep, envelope, length, DACs, mixer estéreo e filtro passa-altas.

`npm.cmd test` executa os testes de núcleo, entrada, reprodução, áudio e persistência. `npm.cmd run test:hardware` executa 87 testes externos: os 75 da M06 e 12 ROMs `dmg_sound`, com revisão e SHA-256 fixados. Consulte [procedência e protocolos](docs/test-roms.md).

| Suíte                                        | Resultado atual |
| -------------------------------------------- | --------------- |
| Blargg cpu_instrs individuais                | 11 de 11        |
| Blargg instr_timing                          | 1 de 1          |
| Blargg mem_timing individuais                | 3 de 3          |
| Mooneye, seleção DMG da M03                  | 27 de 27        |
| Mooneye, acessos sincronizados ao LCD da M04 | 20 de 20        |
| dmg-acid2, comparação gráfica DMG            | 1 de 1          |
| Mooneye, MBC1 padrão da M06                  | 12 de 12        |
| Blargg dmg_sound, perfil DMG da M07          | 12 de 12        |

As ROMs Blargg são baixadas para uma pasta ignorada. O runner usa a mesma factory e os mesmos mappers da aplicação, preservando os binários originais. As 59 fixtures Mooneye preservam a licença MIT.

## Som

Escolha um jogo da biblioteca e clique em **Ativar som**. O navegador precisa dessa ação explícita para abrir a saída de áudio. Use **Volume** para ajustar o nível e **Silenciar** para mutar sem parar o jogo. Se a máquina estiver pausada, clique também em **Iniciar**. O jardim é um diagnóstico visual sem trilha sonora.

Áudio exige um navegador com AudioWorklet em **HTTPS ou localhost**. Acesso por HTTP em um IP da rede local pode não oferecer AudioWorklet; nesse caso, a interface explica a indisponibilidade e o jogo continua sem som. O Worker usa a taxa real do AudioContext, e as filas são limpas ao pausar ou reiniciar para evitar reproduzir trechos antigos.

Os 12 testes `dmg_sound` validam o comportamento que a CPU consegue observar, incluindo registradores, length, sweep e wave RAM. Eles não comprovam equivalência acústica completa com um console físico. Consulte [funcionamento e limites do áudio](docs/audio-runtime.md).

## Saves de bateria

O progresso que o próprio jogo grava na RAM de bateria é salvo automaticamente em IndexedDB. A chave usa o SHA-256 dos bytes da ROM, portanto renomear o mesmo arquivo não cria outro save. Jogos diferentes mantêm dados separados. A interface informa quando recupera o progresso ou quando o armazenamento está indisponível.

As gravações ocorrem em lotes periódicos quando a RAM muda e nos checkpoints de pausa, troca de cartucho e saída da aba. Reiniciar a máquina preserva a bateria. Os dados pertencem ao navegador e à origem do site; limpar os dados do site ou mudar de origem não mantém esses saves. Não há conta nem sincronização em nuvem.

Esse recurso preserva apenas os dados de progresso que cada jogo decide gravar. Salvar e restaurar a máquina inteira em qualquer momento pertence aos save states da M08.

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

Os grupos M00 a M02 e M03 a M05 foram aprovados pelo proprietário. O [roteiro de teste M03 a M05](docs/testing-m03-m05.md) permanece como referência. O grupo atual contém M06, M07 e M08, com M06 e M07 concluídas e M08 pendente. A próxima pausa para teste será antes da M09, com instruções e resultados esperados.

## Vídeo e reprodução

Clique em **Explorar jardim** para abrir POCKET GARDEN. O cenário de quatro tons permanece parado. Um personagem original de 8 por 16 pixels pode passear pelo jardim; a legenda inferior usa a janela do Game Boy. Tudo é produzido por instruções SM83, tiles, mapas e OAM reais.

| Entrada                        | Efeito no jardim                                         |
| ------------------------------ | -------------------------------------------------------- |
| Setas ou direcional do console | Move o personagem, inclusive em diagonal                 |
| Z ou botão A                   | Alterna a aparência uma vez por pressionamento           |
| X ou botão B                   | Volta à posição inicial                                  |
| Enter e Shift                  | Enviam Start e Select; o jardim não atribui ações a eles |

Os botões do console funcionam por toque ou ponteiro. **Pausar** congela a máquina; **Iniciar** retoma; **Reiniciar** volta ao começo em pausa. Trocar a paleta altera a tela sem reiniciar o cartucho. Abrir a ajuda também pausa a reprodução.

A execução pausa quando a aba fica oculta. O botão Iniciar retoma sem tentar recuperar todo o tempo acumulado. O painel de CPU e o Canvas apresentam dados da mesma máquina no Worker; comandos manuais exigem pausa.

A PPU usa renderização por scanline e não modela pixel FIFO, alterações de registradores dentro do modo 3 ou as peculiaridades de janela em WX 0 e 166. dmg-acid2 coincide com os 23.040 pixels oficiais, mas isso não comprova precisão completa do PPU. A escala considera pixels físicos e a densidade da tela, com suavização desabilitada.

## Planejamento

O [plano original](plano-emulador-gameboy.md) preserva a proposta inicial. O [roteiro de milestones](docs/milestones.md) registra o plano aprovado e o estado real.

## Conteúdo de terceiros

Não há jogo comercial ou boot ROM distribuídos. Tobu Tobu Girl e 2048 são homebrews com redistribuição autorizada; os binários originais e seus créditos acompanham o site. Consulte [origem, controles e licenças dos jogos](docs/demo-games.md).

POCKET TEST e POCKET GARDEN, incluindo cenário, personagem e letras, são criações próprias. As ROMs externas ficam restritas aos testes. As fontes DM Sans e Space Mono são fornecidas localmente pelos pacotes Fontsource. Consulte [créditos e licenças](docs/third-party.md).

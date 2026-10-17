# Pocket Lab

Um emulador de Game Boy DMG no navegador, com núcleo TypeScript independente da interface.

Experimente a [beta pública do Pocket Lab](https://gameboy-emulator-aox.pages.dev/), publicada no Cloudflare Pages.

Projeto em desenvolvimento, com M00 a M12 implementadas. CPU, timer, DMA, vídeo, sprites, janela, controles, MBC1, saves de bateria, áudio, save states versionados e rewind já estão disponíveis. A M12 acrescenta MBC2, MBC3 com RTC, MBC5, setas maiores no toque e abastecimento adaptativo de áudio. A biblioteca oferece Tobu Tobu Girl e 2048; o jardim é uma ROM própria de diagnóstico. A homologação mobile no aparelho real continua pendente.

**Validação mobile pendente:** o proprietário relatou lentidão somente após ativar o som no Motorola Edge 40 Neo com Chrome. A M12 corrige a limitação de vazão reproduzida sob atraso controlado de mensagens. O teste automatizado em computador não homologa o aparelho real. Consulte [diagnóstico e implementação MB01](docs/mobile-audio-investigation.md) e o [roteiro M12 a M14](docs/testing-m12-m14.md).

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

A M10 acrescenta benchmarks reproduzíveis, avanço interno por T-cycle sem validações repetidas e recálculo do mixer quando a amplitude muda. Os formatos dos estados são preservados. A suíte de produção testa o build final sob CSP, incluindo Worker, áudio e arquivos locais. Consulte [desempenho e metodologia](docs/performance.md).

IndexedDB armazena a RAM de bateria e três slots de estado por cartucho, identificados pelo SHA-256 da ROM. Paleta, volume, mute e teclas usam preferências versionadas em localStorage, separadas desses saves. A publicação usa arquivos estáticos no Cloudflare Pages. Consulte a [arquitetura de áudio e execução](docs/audio-runtime.md), o [formato dos estados salvos](docs/save-states.md) e os [controles e preferências](docs/controls-and-preferences.md).

O endereço público da M10 passou pelos dez testes de produção em desktop e perfil Pixel 7 simulado. Worker, áudio, demos, saves, arquivos locais, teclado e tela cheia funcionaram sob os cabeçalhos reais da Cloudflare, sem requisições a terceiros ou violações CSP. Os hashes de HTML, JavaScript, CSS, Worker e Worklet coincidiram com a build medida. O [guia de deploy](docs/deployment.md) registra a publicação e os comandos de validação. A hospedagem estática dispensa inicialização de um processo de servidor; rede e inicialização no navegador continuam existindo.

## Cartuchos e testes atuais

Escolha **Tobu Tobu Girl** ou **2048** na biblioteca para começar sem arquivo. **Controles e créditos dos jogos** explica as ações e apresenta os autores e as licenças. Use **Explorar jardim** para abrir o diagnóstico visual. Para carregar um jogo próprio, selecione um arquivo `.gb` ou `.gbc`, ou arraste-o para a página. Os bytes são lidos localmente e não são enviados. A ajuda **Quais arquivos posso usar?** explica formatos, extração de `.zip` e compatibilidade.

A execução aceita cartuchos **ROM Only de 32 KiB**, **MBC1 e MBC3 de até 2 MiB**, **MBC2 de até 256 KiB** e **MBC5 de até 8 MiB**, compatíveis com o Game Boy original. MBC2 possui 512 nibbles internos; MBC3 inclui RTC nos tipos que possuem relógio; MBC5 admite até 128 KiB de RAM. MBC1 usa fiação padrão: ROMs de até 512 KiB admitem até 32 KiB de RAM; ROMs maiores admitem até 8 KiB. A convenção homebrew de RAM de 2 KiB é aceita com aviso, incluindo o 2048. Consulte [controladores e limites](docs/cartridge-mappers.md).

Compilações **MBC1M** usam outra fiação e ficam fora do escopo atual. Não há autodetecção de MBC1M, cujo header também pode declarar MBC1. MBC30 e jogos exclusivos de Game Boy Color não são suportados. Arquivos `.gbc` precisam funcionar também no DMG. Rumble não produz vibração física. O tamanho de ROM precisa ser uma potência de dois, com limite de leitura de 8 MiB. Não é necessário fornecer BIOS ou boot ROM.

O bus implementa memória de trabalho, echo RAM, VRAM, OAM, HRAM, timer, DMA de OAM, interrupções, joypad, PPU e APU. A transferência serial interna leva 4096 T-cycles por byte. A PPU implementa fundo, tiles, scroll, modos, LY/LYC, STAT, sprites e janela. A APU implementa dois canais de pulso, wave e noise, com sweep, envelope, length, DACs, mixer estéreo e filtro passa-altas.

`npm.cmd test` executa os testes de núcleo, entrada, reprodução, áudio e persistência. `npm.cmd run test:hardware` executa 103 testes externos, com revisão e SHA-256 fixados. Consulte [procedência e protocolos](docs/test-roms.md). `npm.cmd run test:audio-flow` usa o build final para medir velocidade e abastecimento com atraso controlado de mensagens; não substitui um celular físico.

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
| Mooneye, MBC2, MBC5 e DMA da M12             | 16 de 16        |

As ROMs Blargg são baixadas para uma pasta ignorada. O runner usa a mesma factory e os mesmos mappers da aplicação, preservando os binários originais. As 75 fixtures Mooneye preservam a licença MIT.

## Som

Escolha um jogo da biblioteca e clique em **Ativar som**. O navegador precisa dessa ação explícita para abrir a saída de áudio. Use **Volume** para ajustar o nível e **Silenciar** para mutar sem parar o jogo. Se a máquina estiver pausada, clique também em **Iniciar**. O jardim é um diagnóstico visual sem trilha sonora. O volume fica guardado neste navegador, mas abrir ou recarregar a página continua exigindo a ativação do som por gesto.

Áudio exige um navegador com AudioWorklet em **HTTPS ou localhost**. Acesso por HTTP em um IP da rede local pode não oferecer AudioWorklet; nesse caso, a interface explica a indisponibilidade e o jogo continua sem som. O Worker usa a taxa real do AudioContext, e as filas são limpas ao pausar ou reiniciar para evitar reproduzir trechos antigos.

Os 12 testes `dmg_sound` validam o comportamento que a CPU consegue observar, incluindo registradores, length, sweep e wave RAM. Eles não comprovam equivalência acústica completa com um console físico. Consulte [funcionamento e limites do áudio](docs/audio-runtime.md).

## Saves de bateria

O progresso que o próprio jogo grava na RAM de bateria é salvo automaticamente em IndexedDB. A chave usa o SHA-256 dos bytes da ROM, portanto renomear o mesmo arquivo não cria outro save. Jogos diferentes mantêm dados separados. A interface informa quando recupera o progresso ou quando o armazenamento está indisponível.

As gravações ocorrem em lotes periódicos quando a RAM muda e nos checkpoints de pausa, troca de cartucho e saída da aba. Reiniciar a máquina preserva a bateria. Os dados pertencem ao navegador e à origem do site; limpar os dados do site ou mudar de origem não mantém esses saves. Não há conta nem sincronização em nuvem.

Cartuchos MBC3 com RTC salvam RAM e relógio juntos, inclusive quando não possuem RAM externa. O relógio avança em T-cycles durante a emulação e congela na pausa. Ao reabrir a bateria, o adaptador acrescenta os segundos inteiros transcorridos desde o último checkpoint entregue ao armazenamento, respeitando o halt do cartucho. A precisão offline é de segundos e depende do relógio do dispositivo; encerrar a aba abruptamente pode impedir a última gravação. Save states e rewind recuperam o instante exato sem compensação offline. O envelope RTC v2 preserva a leitura dos saves de RAM v1.

Esse recurso preserva os dados de progresso que cada jogo decide gravar. Não garante retornar à posição exata em que a partida foi interrompida. Para guardar esse ponto, use um estado salvo.

## Estados salvos

O painel **Um ponto para voltar.** oferece três slots por cartucho. Selecione um slot e use **Salvar estado** para guardar a máquina no ponto atual, substituindo o conteúdo anterior desse slot. A operação pausa o jogo. **Carregar estado** restaura o ponto e mantém a máquina em pausa; use **Iniciar** para continuar.

**Exportar estado** baixa o ponto atual em um arquivo `.pocketstate`, mesmo sem um slot gravado. **Importar estado** valida o arquivo para o cartucho aberto, restaura a máquina em pausa e grava no slot selecionado. O arquivo não contém a ROM; mantenha o mesmo cartucho para usá-lo. Exportações servem de backup porque os slots pertencem ao navegador e à origem do site.

O formato tem limite de 1 MiB, versão, modelo DMG-CPU-B, hash da ROM e checksum SHA-256. Arquivos corrompidos ou incompatíveis são rejeitados sem substituir o estado da máquina. A migração para IndexedDB v2 preserva os saves de bateria anteriores. Consulte [conteúdo, validação e limites dos estados](docs/save-states.md).

## Controles e preferências

Abra **Controles e preferências** para remapear o teclado. Clique no campo de uma ação e pressione a substituta. Tab navega entre campos; Esc sai do campo. Conflitos entre ações e teclas reservadas geram uma mensagem e preservam o mapa anterior. **Restaurar teclado padrão** recupera as setas, Z, X, Enter e Shift. Abrir o painel pausa a partida; use **Iniciar** para retomar.

Paleta, volume, mute e teclado são guardados em localStorage. Se o navegador bloquear esse armazenamento, os ajustes continuam funcionando na sessão e a interface informa a limitação. Isso não altera os slots ou a RAM de bateria em IndexedDB.

Controles USB ou Bluetooth reconhecidos com `mapping="standard"` usam direcional ou analógico esquerdo, botões A/B e Select/Start. Pressione um botão do controle para o navegador reconhecer a conexão. Teclado, toque e múltiplos controles mantêm fontes independentes. A integração foi verificada com entradas simuladas; o teste de um controle físico ainda depende do proprietário.

**Tela cheia** usa o recurso nativo do navegador. Se estiver indisponível ou for recusado, a interface informa o motivo e mantém a página utilizável. O primeiro link ao navegar por Tab, **Ir para o console**, permite saltar o cabeçalho. Consulte [configuração, suporte e roteiro de conferência](docs/controls-and-preferences.md).

## Rewind

O painel **Um instante atrás.** oferece **Ativar rewind**. Depois de ativar e jogar um pouco, segure **R** com a tela em foco ou o botão **Segure para voltar**. Soltar escolhe o ponto atual e retoma somente se a partida estava em execução. Se já estava pausada, permanece assim. Perder foco, ocultar a aba ou cancelar o gesto encerra em pausa. R continua disponível para uma ação do jogo quando estiver remapeado.

O Worker guarda até 20 segundos de tempo emulado, com capturas de aproximadamente 10 Hz e uma arena de buffers limitada a 8 MiB. O histórico é temporário, fica nesta aba e é descartado ao desativar, carregar outro estado ou trocar o cartucho. Voltar também restaura a RAM do jogo; a bateria recebe o ponto final escolhido, sem gravar os pontos intermediários. Consulte [funcionamento e limites](docs/rewind.md) e [medição de custo e restauração](docs/performance.md#rewind-na-m11).

## Testar as milestones

O [roteiro M06 a M08](docs/testing-m06-m08.md) registra os testes do grupo aprovado. O [roteiro M09 a M11](docs/testing-m09-m11.md) preserva a revisão anterior. O [roteiro M12 a M14](docs/testing-m12-m14.md) acompanha o grupo atual. A validação da M12 inclui 103 testes externos, 156 cenários de interface e 14 testes de produção. Dois casos de interface foram repetidos após corrigir a expectativa da fixture de mapper incompatível, agora 0x22. A regressão isolada de áudio passou nos seis cenários, com velocidade de 99,30% a 100,24% e zero frames ausentes ou descartados nas janelas estáveis. Veja [dados e escopo](docs/performance-audio-mobile-results.json). A cobertura automatizada não representa aceite do Motorola.

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

Os grupos M00 a M02, M03 a M05 e M06 a M08 foram aprovados pelo proprietário. Os roteiros de teste [M03 a M05](docs/testing-m03-m05.md) e [M06 a M08](docs/testing-m06-m08.md) permanecem como referências das entregas anteriores. M09 a M11 foram revisadas, com desktop aprovado e MB01 identificado no mobile. O grupo M12 a M14 está em andamento, autorizado em 17/10/2026.

## Vídeo e reprodução

Clique em **Explorar jardim** para abrir POCKET GARDEN. O cenário de quatro tons permanece parado. Um personagem original de 8 por 16 pixels pode passear pelo jardim; a legenda inferior usa a janela do Game Boy. Tudo é produzido por instruções SM83, tiles, mapas e OAM reais.

| Entrada                        | Efeito no jardim                                         |
| ------------------------------ | -------------------------------------------------------- |
| Setas ou direcional do console | Move o personagem, inclusive em diagonal                 |
| Z ou botão A                   | Alterna a aparência uma vez por pressionamento           |
| X ou botão B                   | Volta à posição inicial                                  |
| Enter e Shift                  | Enviam Start e Select; o jardim não atribui ações a eles |

As teclas da tabela são o mapa padrão e podem ser alteradas em **Controles e preferências**. O direcional e o analógico esquerdo de um controle padrão enviam as mesmas ações.

Os botões do console funcionam por toque ou ponteiro. **Pausar** congela a máquina; **Iniciar** retoma; **Reiniciar** volta ao começo em pausa. Trocar a paleta altera a tela sem reiniciar o cartucho. Abrir a ajuda também pausa a reprodução.

A execução pausa quando a aba fica oculta. O botão Iniciar retoma sem tentar recuperar todo o tempo acumulado. O painel de CPU e o Canvas apresentam dados da mesma máquina no Worker; comandos manuais exigem pausa.

A PPU usa renderização por scanline e não modela pixel FIFO, alterações de registradores dentro do modo 3 ou as peculiaridades de janela em WX 0 e 166. dmg-acid2 coincide com os 23.040 pixels oficiais, mas isso não comprova precisão completa do PPU. A escala considera pixels físicos e a densidade da tela, com suavização desabilitada.

## Planejamento

O [plano original](plano-emulador-gameboy.md) preserva a proposta inicial. O [roteiro de milestones](docs/milestones.md) registra o plano aprovado e o estado real.

## Conteúdo de terceiros

Não há jogo comercial ou boot ROM distribuídos. Tobu Tobu Girl e 2048 são homebrews com redistribuição autorizada; os binários originais e seus créditos acompanham o site. Consulte [origem, controles e licenças dos jogos](docs/demo-games.md).

POCKET TEST e POCKET GARDEN, incluindo cenário, personagem e letras, são criações próprias. As ROMs externas ficam restritas aos testes. As fontes DM Sans e Space Mono são fornecidas localmente pelos pacotes Fontsource. Consulte [créditos e licenças](docs/third-party.md).

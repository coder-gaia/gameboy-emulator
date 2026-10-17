# Plano de implementação e acompanhamento

Stack aprovada: TypeScript estrito, React, Vite, CSS Modules, Canvas 2D, Worker, AudioWorklet, IndexedDB, Vitest, Playwright e GitHub Actions. Um pacote npm, sem monorepo. Beta estática publicada em [gameboy-emulator-aox.pages.dev](https://gameboy-emulator-aox.pages.dev/).

| Marco | Entrega                                             | Estado    |
| ----- | --------------------------------------------------- | --------- |
| M00   | Fundação, regras, CI e direção visual               | Concluída |
| M01   | Header, ROM Only, bus, serial e runner de ROMs      | Concluída |
| M02   | CPU SM83, instruções, flags e ciclos                | Concluída |
| M03   | Timers, interrupções, HALT, DMA e suítes de timing  | Concluída |
| M04   | PPU, fundo, tiles e scroll                          | Concluída |
| M05   | Sprites, janela, joypad e dmg-acid2                 | Concluída |
| M06   | MBC1, bateria e biblioteca de demos autorizadas     | Concluída |
| M07   | APU, Worker e sincronização de áudio                | Concluída |
| M08   | Save states versionados e slots                     | Concluída |
| M09   | Interface completa, controles e acessibilidade      | Concluída |
| M10   | Desempenho e beta pública                           | Concluída |
| M11   | Rewind com memória limitada                         | Concluída |
| M12   | Correção mobile, setas maiores, MBC2, MBC3 e MBC5   | Concluída |
| M13   | Painel técnico completo                             | Pendente  |
| M14   | Release, README, portfólio e material para LinkedIn | Pendente  |

## Pontos de revisão

Os grupos M00 a M02 e M03 a M05 foram aprovados pelo proprietário. O [roteiro de teste M03 a M05](testing-m03-m05.md) permanece como referência das entregas anteriores.

O grupo M06, M07 e M08 foi aprovado pelo proprietário. O [roteiro de teste M06 a M08](testing-m06-m08.md) permanece como referência. M09, M10 e M11 estão concluídas. Na revisão do [roteiro M09 a M11](testing-m09-m11.md), o proprietário aprovou desktop e isolou lentidão no Motorola Edge 40 Neo com Chrome somente depois de ativar o som. Em 16/10/2026 foi registrado apenas o diagnóstico; em 17/10/2026 o proprietário autorizou continuar M12 a M14. Cada milestone deve ter seu commit validado, push imediato e confirmação no GitHub antes da seguinte. Os commits e resultados da validação ficam disponíveis no histórico e nas execuções de CI do GitHub.

M09 completa preferências, remapeamento de teclado, gamepad padrão, tela cheia e acessibilidade. M10 mede desempenho de produção e publica a beta estática no Cloudflare Pages. M11 acrescenta rewind com memória limitada. Como último passo do grupo, o fundo recebeu o creme #eee9df, preservando contraste e aparência do console sem opacidade ou sobreposição.

O cartucho sintético POCKET TEST permite testar CPU, memória e serial sem obter jogos. O [README](../README.md#testar-o-primeiro-grupo-de-milestones) explica o roteiro inicial. M03 adiciona timers, DMA, correção de EI seguido de HALT e prioridades de interrupção durante escrita na pilha, com 42 ROMs externas aprovadas.

M04 adiciona modos do LCD, fundo, tiles, scroll e o cartucho próprio POCKET GARDEN, com 62 ROMs externas de timing aprovadas. A validação também corrigiu a separação dos barramentos de VRAM e memória principal durante DMA.

M05 adiciona sprites de 8 por 8 e 8 por 16 pixels, janela com contador interno, joypad, teclado, toque e ajuda para carregar cartuchos. O jardim mantém o cenário parado, permite mover e trocar o personagem e apresenta uma legenda fixa. dmg-acid2 compara todos os 23.040 pixels com a referência oficial, somando 63 ROMs externas aprovadas no grupo.

M06 adiciona MBC1 padrão, bancos de ROM e RAM, modos de banking e saves de bateria em IndexedDB, separados pelo SHA-256 da ROM. A biblioteca oferece Tobu Tobu Girl e 2048 com binários originais, controles e créditos documentados em [jogos demonstrativos](demo-games.md). A validação usa o mapper real do produto nos Blargg e acrescenta 12 ROMs Mooneye MBC1, totalizando 75 testes externos aprovados e 59 fixtures Mooneye reproduzíveis.

M07 implementa os quatro canais da APU DMG, mixer estéreo, filtro passa-altas e PCM com filas limitadas. A máquina executa em Web Worker; a interface mantém uma cópia para apresentação. Sem áudio, o Worker usa relógio monotônico. Com áudio, AudioWorklet solicita PCM por MessageChannel e controla a cadência na taxa real do dispositivo. O visitante ativa o som explicitamente e pode ajustar volume ou silenciar. Falta de AudioWorklet mantém o jogo sem som. Os 12 testes `dmg_sound` aprovados elevam o total externo a 87. Consulte [arquitetura e limites](audio-runtime.md).

M08 adiciona estados completos e versionados, três slots por SHA-256 da ROM e importação ou exportação de arquivos `.pocketstate`. CPU, memória, mapper, PPU, timer, DMA, serial, joypad e APU são capturados, incluindo fases pendentes necessárias à continuação. A restauração valida uma máquina candidata antes de alterar a atual. As filas PCM de apresentação são descartadas; a fase de amostragem e o filtro da APU são preservados na mesma taxa de áudio. IndexedDB v2 acrescenta os slots e preserva a bateria existente. O formato limita arquivos a 1 MiB e confere versões, modelo DMG-CPU-B, ROM e checksum SHA-256. Consulte [estados salvos](save-states.md).

M09 acrescenta remapeamento das oito ações do teclado, preferências versionadas em localStorage, gamepads com mapeamento padrão e tela cheia nativa com fallback. Entradas simultâneas mantêm fontes independentes e são liberadas ao perder foco, pausar ou desconectar. A revisão corrige contraste e nomes acessíveis, amplia foco visível, preserva a ativação nativa de painéis e evita anúncios contínuos dos registradores. Os testes incluem axe, larguras de 320, 390 e 1440 pixels e jogo em tela cheia em retrato e paisagem. Controle físico e leitores de tela reais continuam dependendo da revisão manual. Consulte [controles e preferências](controls-and-preferences.md).

M10 está concluída e publicada em [gameboy-emulator-aox.pages.dev](https://gameboy-emulator-aox.pages.dev/). A otimização mantém estado e PCM idênticos e apresenta ganhos nos três cenários de núcleo medidos. O build estático recebe cache, CSP e testes de produção; os benchmarks separam Node, desktop e viewport móvel com CPU simulada. Os dez testes de produção também passaram sob os cabeçalhos reais da Cloudflare, com hashes de assets idênticos aos da build medida e sem erros, violações CSP ou requisições a terceiros. Consulte [metodologia e resultados](performance.md) e [publicação validada](deployment.md).

M11 está concluída. O Worker captura estados a aproximadamente 10 Hz de tempo emulado em uma arena de buffers de 8 MiB, retendo até 20 segundos por sessão. O usuário ativa o recurso, segura R ou o botão de voltar e escolhe um ponto ao soltar. A restauração recupera máquina e RAM, limpa a apresentação de áudio e preserva a pausa quando necessário. Os controles ficam bloqueados até a gravação final da bateria; cancelamentos e falhas de áudio mantêm a máquina recuperável. A interface oferece o gesto por teclado, mouse, toque e tecnologia assistiva, inclusive em tela cheia. A validação inclui 677 testes locais, 87 externos, 26 casos específicos de navegador, revisão de acessibilidade e 14 testes no artefato de produção. O benchmark preservou estado e PCM nos três cenários, incluindo MBC1 de 2 MiB. Consulte [funcionamento e limites](rewind.md) e [medição reproduzível](performance.md#rewind-na-m11).

Cada milestone recebe um commit, com título Conventional Commits em inglês e corpo em pt-br. Sem autoria ou coautoria de ferramentas de IA e sem caracteres de travessão.

Cada commit validado deve receber push imediatamente e ser confirmado no GitHub. O proprietário não precisa receber links individuais. A pausa a cada três milestones não adia o envio dos commits ao GitHub. Aguardar o ok dos testes antes de iniciar o próximo grupo.

## Grupo M12 a M14 em andamento

**MB01 é prioridade da M12:** investigar e corrigir a cadência de áudio que desacelera a máquina no celular. Sem som, os três cartuchos ficaram fluidos no aparelho do proprietário. O diagnóstico reproduziu o padrão ao atrasar mensagens entre Worker e Worklet, mas ainda não mediu a origem do atraso no Motorola. O perfil Pixel 7 em desktop não homologou essa condição. Consulte [evidências, métricas e critérios](mobile-audio-investigation.md).

A M12 implementa reposição PCM pelo déficit completo e consumo previsto em voo, reserva em tempo adaptada ao atraso observado no Worklet e contagem de rebuffer. As setas de toque têm alvos de 52 px e ícones de 22 px quando há espaço, preservando 44 px em 320 px e os tamanhos desktop. MBC2, MBC3 com RTC e MBC5 incluem estados completos, bateria e rewind. O envelope de bateria RTC v2 mantém compatibilidade com RAM v1 e admite relógio sem RAM. A arena de rewind permanece 8 MiB, com checkpoints de até 256 KiB. Passaram 103 testes externos, incluindo 16 casos Mooneye novos. Consulte [mappers e política de tempo](cartridge-mappers.md).

O fechamento automatizado da M12 aprovou `npm run check`, com 777 testes locais e build, 103 testes de hardware, 156 cenários de interface e 14 testes de produção sob CSP. Depois do ajuste final do áudio, os 32 cenários pertinentes de áudio, estados e rewind passaram novamente. A regressão isolada de transporte aprovou os seis cenários, com velocidade de 99,30% a 100,24% e zero frames ausentes ou descartados nas janelas estáveis; o [relatório](performance-audio-mobile-results.json) fixa os hashes e o escopo. A regressão de interface teve dois casos repetidos depois de ajustar a expectativa da fixture incompatível: MBC3 e MBC5 agora são suportados; 0x22 permanece recusado. Os testes de RTC incluem bateria sem RAM, migração v1, offline, halt, importação atômica e preservação de slots. A homologação no Motorola permanece pendente.

A M13 mantém o painel técnico e a M14 mantém release, portfólio e material para LinkedIn. O lançamento depende do aceite com áudio no aparelho real, além da regressão desktop. O [roteiro do grupo](testing-m12-m14.md) separa validações automatizadas e testes manuais pendentes. Preservar o grupo de três milestones e o commit por milestone.

## Critérios de qualidade

- Tipos, lint, formatação, regras de escrita e build aprovados.
- Núcleo sem dependências de navegador, verificado por configuração TypeScript própria.
- Testes determinísticos de instruções, memória e serial quando disponíveis.
- Testes de navegador para os fluxos implementados, incluindo viewport móvel.
- Informar resultados reais. Blargg, Mooneye e dmg-acid2 têm revisão, hash, licença e protocolo registrados em [ROMs externas de teste](test-roms.md).
- A biblioteca distribui somente demos com procedência, licença e créditos registrados. A bateria é validada por versão, hash da ROM e tamanho da RAM; estados também validam modelo, checksum e os campos de todos os componentes antes da restauração.

## Escopo e metas

A beta pública da M10 inclui demos, áudio, toque, teclado, gamepad, paletas, bateria e save states. A M11 acrescenta rewind; M12 amplia cartuchos e fluxo de áudio. O painel técnico completo continua na M13.

A aplicação executa ROM Only de 32 KiB, MBC1 e MBC3 de até 2 MiB, MBC2 de até 256 KiB e MBC5 de até 8 MiB em potência de dois. MBC1 mantém a fiação padrão, com até 32 KiB de RAM para ROMs de até 512 KiB e até 8 KiB para ROMs maiores. MBC2 usa 512 nibbles internos, MBC3 até 32 KiB de RAM e RTC quando presente, MBC5 até 128 KiB de RAM. A convenção homebrew de RAM de 2 KiB é aceita com aviso. MBC1M e MBC30 não são implementados; não há autodetecção de MBC1M. Rumble não gera vibração física.

MBC1, bateria e a biblioteca fazem parte da M06 concluída. Áudio, APU, Worker e sincronização fazem parte da M07 concluída. Estados versionados, slots e arquivos de backup fazem parte da M08 concluída. O jardim é uma fixture interativa própria, sem trilha ou bateria, e pode usar os estados salvos para retornar a uma posição exata. A inicialização pós boot não reproduz integralmente todas as revisões físicas. A PPU por scanline ainda não cobre pixel FIFO, escritas dentro do modo 3 ou peculiaridades de WX 0 e 166. A aprovação de `dmg_sound` verifica comportamento observável pela CPU e não comprova equivalência acústica integral.

Meta de demo pronta em três segundos em perfil de teste documentado. Medir velocidade real da emulação, áudio e memória em celular. Cloudflare Pages elimina cold start de servidor, mantendo os custos normais de rede e inicialização no navegador.

Direção visual: bancada de cartuchos, papel quente, grafite, cinza mineral e violeta fechado apenas em ações e foco. Interface responsiva, contraste, teclado, áreas de toque confortáveis e movimento reduzido.

Previsão inicial: 10 a 16 semanas para beta e 16 a 24 para escopo completo, com 10 a 15 horas semanais. Reavaliar após CPU e timing. GBC, contas, backend, multiplayer e sincronização em nuvem ficam fora do V1.

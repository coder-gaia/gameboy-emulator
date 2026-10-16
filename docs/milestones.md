# Plano de implementação e acompanhamento

Stack aprovada: TypeScript estrito, React, Vite, CSS Modules, Canvas 2D, Worker, AudioWorklet, IndexedDB, Vitest, Playwright e GitHub Actions. Um pacote npm, sem monorepo. Publicação estática futura no Cloudflare Pages Free.

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
| M08   | Save states versionados e slots                     | Pendente  |
| M09   | Interface completa, controles e acessibilidade      | Pendente  |
| M10   | Desempenho móvel e beta pública                     | Pendente  |
| M11   | Rewind com memória limitada                         | Pendente  |
| M12   | MBC2, MBC3 com RTC e MBC5                           | Pendente  |
| M13   | Painel técnico completo                             | Pendente  |
| M14   | Release, README, portfólio e material para LinkedIn | Pendente  |

## Pontos de revisão

Os grupos M00 a M02 e M03 a M05 foram aprovados pelo proprietário. O [roteiro de teste M03 a M05](testing-m03-m05.md) permanece como referência das entregas anteriores.

O grupo atual contém M06, M07 e M08. M06 e M07 estão concluídas; M08 permanece pendente. **Pausar antes da M09 e aguardar o ok do proprietário**, entregando o roteiro de teste do grupo com resultados esperados. Cada milestone deve ter seu commit validado, push imediato e confirmação no GitHub antes da seguinte. M06 já teve seu commit enviado e o CI do GitHub aprovado.

O cartucho sintético POCKET TEST permite testar CPU, memória e serial sem obter jogos. O [README](../README.md#testar-o-primeiro-grupo-de-milestones) explica o roteiro inicial. M03 adiciona timers, DMA, correção de EI seguido de HALT e prioridades de interrupção durante escrita na pilha, com 42 ROMs externas aprovadas.

M04 adiciona modos do LCD, fundo, tiles, scroll e o cartucho próprio POCKET GARDEN, com 62 ROMs externas de timing aprovadas. A validação também corrigiu a separação dos barramentos de VRAM e memória principal durante DMA.

M05 adiciona sprites de 8 por 8 e 8 por 16 pixels, janela com contador interno, joypad, teclado, toque e ajuda para carregar cartuchos. O jardim mantém o cenário parado, permite mover e trocar o personagem e apresenta uma legenda fixa. dmg-acid2 compara todos os 23.040 pixels com a referência oficial, somando 63 ROMs externas aprovadas no grupo.

M06 adiciona MBC1 padrão, bancos de ROM e RAM, modos de banking e saves de bateria em IndexedDB, separados pelo SHA-256 da ROM. A biblioteca oferece Tobu Tobu Girl e 2048 com binários originais, controles e créditos documentados em [jogos demonstrativos](demo-games.md). A validação usa o mapper real do produto nos Blargg e acrescenta 12 ROMs Mooneye MBC1, totalizando 75 testes externos aprovados e 59 fixtures Mooneye reproduzíveis.

M07 implementa os quatro canais da APU DMG, mixer estéreo, filtro passa-altas e PCM com filas limitadas. A máquina executa em Web Worker; a interface mantém uma cópia para apresentação. Sem áudio, o Worker usa relógio monotônico. Com áudio, AudioWorklet solicita PCM por MessageChannel e controla a cadência na taxa real do dispositivo. O visitante ativa o som explicitamente e pode ajustar volume ou silenciar. Falta de AudioWorklet mantém o jogo sem som. Os 12 testes `dmg_sound` aprovados elevam o total externo a 87. Consulte [arquitetura e limites](audio-runtime.md).

Cada milestone recebe um commit, com título Conventional Commits em inglês e corpo em pt-br. Sem autoria ou coautoria de ferramentas de IA e sem caracteres de travessão.

Cada commit validado deve receber push imediatamente e ser confirmado no GitHub. O proprietário não precisa receber links individuais. A pausa a cada três milestones não adia o envio dos commits ao GitHub. Aguardar o ok dos testes antes de iniciar o próximo grupo.

## Critérios de qualidade

- Tipos, lint, formatação, regras de escrita e build aprovados.
- Núcleo sem dependências de navegador, verificado por configuração TypeScript própria.
- Testes determinísticos de instruções, memória e serial quando disponíveis.
- Testes de navegador para os fluxos implementados, incluindo viewport móvel.
- Informar resultados reais. Blargg, Mooneye e dmg-acid2 têm revisão, hash, licença e protocolo registrados em [ROMs externas de teste](test-roms.md).
- A biblioteca distribui somente demos com procedência, licença e créditos registrados. Os saves locais são validados por versão, hash da ROM e tamanho da RAM.

## Escopo e metas

A beta da M10 terá demo, áudio, toque, teclado, gamepad, paletas, bateria e save states. O lançamento completo adiciona rewind, cartuchos ampliados e debugger.

A aplicação atual executa ROM Only de 32 KiB e MBC1 padrão com ROM de até 2 MiB em potência de dois. ROMs de até 512 KiB admitem até 32 KiB de RAM; ROMs de 1 MiB ou 2 MiB admitem até 8 KiB, conforme a fiação física. A convenção homebrew de RAM de 2 KiB é aceita com aviso. MBC1M usa outra fiação, não é implementado e não possui autodetecção.

MBC1, bateria e a biblioteca fazem parte da M06 concluída. Áudio, APU, Worker e sincronização fazem parte da M07 concluída. Save states versionados e slots pertencem à M08 pendente. O jardim é uma fixture interativa própria, sem trilha ou saves. A inicialização pós boot não reproduz integralmente todas as revisões físicas. A PPU por scanline ainda não cobre pixel FIFO, escritas dentro do modo 3 ou peculiaridades de WX 0 e 166. A aprovação de `dmg_sound` verifica comportamento observável pela CPU e não comprova equivalência acústica integral.

Meta de demo pronta em três segundos em perfil de teste documentado. Medir velocidade real da emulação, áudio e memória em celular. Cloudflare Pages elimina cold start de servidor, mantendo os custos normais de rede e inicialização no navegador.

Direção visual: bancada de cartuchos, papel quente, grafite, cinza mineral e violeta fechado apenas em ações e foco. Interface responsiva, contraste, teclado, áreas de toque confortáveis e movimento reduzido.

Previsão inicial: 10 a 16 semanas para beta e 16 a 24 para escopo completo, com 10 a 15 horas semanais. Reavaliar após CPU e timing. GBC, contas, backend, multiplayer e sincronização em nuvem ficam fora do V1.

# Entregas e aceite

Um pacote npm, sem monorepo. Candidata **1.0.0-rc.1** publicada em [Pocket Lab](https://gameboy-emulator-aox.pages.dev/).

| Marco | Entrega                                              | Estado    |
| ----- | ---------------------------------------------------- | --------- |
| M00   | Fundação, regras, CI e direção visual                | Concluída |
| M01   | Header, ROM Only, bus, serial e runner               | Concluída |
| M02   | CPU SM83, instruções, flags e ciclos                 | Concluída |
| M03   | Timers, interrupções, HALT, DMA e timing             | Concluída |
| M04   | PPU, fundo, tiles e scroll                           | Concluída |
| M05   | Sprites, janela, joypad e dmg-acid2                  | Concluída |
| M06   | MBC1, bateria e demos autorizadas                    | Concluída |
| M07   | APU, Worker e sincronização de áudio                 | Concluída |
| M08   | Save states versionados e slots                      | Concluída |
| M09   | Controles, preferências e acessibilidade             | Concluída |
| M10   | Desempenho e beta pública                            | Concluída |
| M11   | Rewind com memória limitada                          | Concluída |
| M12   | Áudio adaptativo, setas maiores, MBC2, MBC3 e MBC5   | Concluída |
| M13   | Inspeção de hardware e diagnóstico local             | Concluída |
| M14   | Apresentação por cursor PCM e candidata a lançamento | Concluída |

## Aceite atual

Os grupos M00 a M02, M03 a M05 e M06 a M08 foram aprovados pelo proprietário. No grupo M09 a M11, o desktop foi aprovado; o Motorola Edge 40 Neo com Chrome apresentou lentidão somente após ativar som.

Após a M12, o proprietário confirmou música contínua e ausência de travadas no Motorola, mas ainda percebeu lentidão com som. A M14 preserva imagens intermediárias e sincroniza a apresentação ao cursor PCM. Foi enviada ao GitHub, aprovada no CI e conferida na publicação. **O grupo M12 a M14 está em pausa para aceite no aparelho real e regressão desktop.**

A validação automatizada da candidata aprovou 1.473 testes locais, 103 externos, 176 cenários de interface, 16 de produção e seis de áudio/vídeo. As suítes de produção e áudio/vídeo também passaram na URL HTTPS. Perfil móvel executado no computador não homologa o Motorola.

Release estável e divulgação no LinkedIn aguardam o aceite. Os roteiros de teste são enviados diretamente no chat, de forma curta e com resultado esperado. Relatórios detalhados, roteiros anteriores e rascunhos de divulgação continuam no histórico do Git.

Cada milestone recebe um commit Conventional Commits, com título em inglês e corpo em pt-br, usando exclusivamente a identidade Git do proprietário. Mensagem, autor e committer são conferidos antes do push imediato. A cada três milestones, aguardar o ok do proprietário antes de avançar.

O [plano original](../plano-emulador-gameboy.md) permanece preservado. As [decisões atuais](architecture.md), a [validação técnica](test-roms.md) e as execuções de [Quality](https://github.com/coder-gaia/gameboy-emulator/actions/workflows/ci.yml) são as referências de manutenção.

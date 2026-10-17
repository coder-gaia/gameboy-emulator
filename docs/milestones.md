# Entregas e aceite

Um pacote npm, sem monorepo. Revisão **1.0.0-rc.3**, candidata em validação para [Pocket Lab](https://gameboy-emulator-aox.pages.dev/).

| Marco | Entrega                                            | Estado    |
| ----- | -------------------------------------------------- | --------- |
| M00   | Fundação, regras, CI e direção visual              | Concluída |
| M01   | Header, ROM Only, bus, serial e runner             | Concluída |
| M02   | CPU SM83, instruções, flags e ciclos               | Concluída |
| M03   | Timers, interrupções, HALT, DMA e timing           | Concluída |
| M04   | PPU, fundo, tiles e scroll                         | Concluída |
| M05   | Sprites, janela, joypad e dmg-acid2                | Concluída |
| M06   | MBC1, bateria e demos autorizadas                  | Concluída |
| M07   | APU, Worker e sincronização de áudio               | Concluída |
| M08   | Save states versionados e slots                    | Concluída |
| M09   | Controles, preferências e acessibilidade           | Concluída |
| M10   | Desempenho e beta pública                          | Concluída |
| M11   | Rewind com memória limitada                        | Concluída |
| M12   | Áudio adaptativo, setas maiores, MBC2, MBC3 e MBC5 | Concluída |
| M13   | Inspeção de hardware e diagnóstico local           | Concluída |
| M14   | Apresentação de vídeo e candidata a lançamento     | Concluída |

Próxima versão, ainda sem implementação: [plano de Big2Small e modo escuro](next-version-plan.md), organizado em M15 a M17.

## Aceite atual

Os grupos M00 a M02, M03 a M05 e M06 a M08 foram aprovados pelo proprietário. No grupo M09 a M11, o desktop foi aprovado; o Motorola Edge 40 Neo com Chrome apresentou lentidão somente após ativar som.

Após a M12, o proprietário confirmou música contínua e ausência de travadas no Motorola, mas ainda percebeu lentidão com som. A M14 passou a preservar imagens intermediárias e sincronizar a apresentação ao cursor PCM. Foi enviada ao GitHub, aprovada no CI e conferida na publicação, mas o teste físico da rc.1 reportou regressão grave com áudio. O diagnóstico mostrou 99,7% de velocidade emulada e apenas 31,9 imagens desenhadas/s.

A rc.2 corrigiu a troca de referência durante reposição, ampliou as reservas e acrescentou a licença MIT de Alexandre Gaia. No teste físico, manteve 100,2% de velocidade emulada, 51,2 desenhos/s e nenhuma falta ou perda de PCM registrada, mas o proprietário reportou cerca de 1,5 segundo entre toque e resposta. Essa latência de entrada não era medida pelas suítes anteriores.

A rc.3 avança CPU e vídeo pelo relógio interativo em ambos os modos. O áudio consome PCM já produzido, sem antecipar o jogo; a imagem não espera a reprodução no alto-falante. Acrescenta medição de entrada nativa até pixel e contadores da fila do produtor. O custo explícito é permitir atraso sonoro em relação à imagem em saídas lentas.

**Em 17/10/2026, o proprietário confirmou controles rápidos e música contínua com Tobu e som ativo no Motorola Edge 40 Neo com Chrome.** A condição para estudar outro homebrew foi atendida. A regressão automatizada desktop passou; lançamento estável e divulgação dependem de instrução do proprietário.

Os resultados e logs automatizados ficam no workflow Quality do commit correspondente. Relógios controlados e perfil móvel no computador reproduzem mecanismos e regressões; não homologam o aparelho físico.

Os roteiros de teste são enviados diretamente no chat, de forma curta e com resultado esperado. Relatórios detalhados, roteiros anteriores e rascunhos de divulgação continuam no histórico do Git.

Cada milestone recebe um commit Conventional Commits, com título em inglês e corpo em pt-br, usando exclusivamente a identidade Git do proprietário. Mensagem, autor e committer são conferidos antes do push imediato. A cada três milestones, aguardar o ok do proprietário antes de avançar.

O [plano original](../plano-emulador-gameboy.md) permanece preservado. As [decisões atuais](architecture.md), a [validação técnica](test-roms.md) e as execuções de [Quality](https://github.com/coder-gaia/gameboy-emulator/actions/workflows/ci.yml) são as referências de manutenção.

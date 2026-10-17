# Entregas e próximos marcos

Um pacote npm, sem monorepo. Revisão **1.0.0-rc.3** publicada no [Pocket Lab](https://gameboy-emulator-aox.pages.dev/), ainda como candidata a lançamento.

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

## Estado atual

A rc.3 usa relógio monotônico para CPU e vídeo, com ou sem som. O áudio consome PCM já produzido e sua reserva não retém a imagem. Os diagnósticos distinguem velocidade emulada, desenhos no Canvas e perdas nas filas PCM. A saída sonora pode chegar depois da imagem em dispositivos com maior latência.

As regressões automatizadas de desktop, produção, áudio e entrada até pixel estão concluídas. A verificação física com Tobu Tobu Girl e som ativo no Motorola Edge 40 Neo com Chrome apresentou controles rápidos e música contínua. Essa validação se limita ao jogo, aparelho e navegador verificados; não equivale à compatibilidade de todos os cartuchos.

## Próxima versão

M15 a M17 estão planejadas, sem implementação: Big2Small na biblioteca, alternância claro/escuro e validação conjunta. O [plano da próxima versão](next-version-plan.md) detalha integração, licenças, persistência do tema e critérios de validação física.

O [plano original](plano-emulador-gameboy.md) permanece preservado. As [decisões atuais](architecture.md), a [validação técnica](test-roms.md) e as execuções de [Quality](https://github.com/coder-gaia/gameboy-emulator/actions/workflows/ci.yml) são as referências de manutenção.

# Plano de implementação e acompanhamento

Stack aprovada: TypeScript estrito, React, Vite, CSS Modules, Canvas 2D, Worker, AudioWorklet, IndexedDB, Vitest, Playwright e GitHub Actions. Um pacote npm, sem monorepo. Publicação estática futura no Cloudflare Pages Free.

| Marco | Entrega                                             | Estado    |
| ----- | --------------------------------------------------- | --------- |
| M00   | Fundação, regras, CI e direção visual               | Concluída |
| M01   | Header, ROM Only, bus, serial e runner de ROMs      | Concluída |
| M02   | CPU SM83, instruções, flags e ciclos                | Concluída |
| M03   | Timers, interrupções, HALT, DMA e suítes de timing  | Pendente  |
| M04   | PPU, fundo, tiles e scroll                          | Pendente  |
| M05   | Sprites, janela, joypad e dmg-acid2                 | Pendente  |
| M06   | MBC1, bateria e demo autorizada                     | Pendente  |
| M07   | APU, Worker e sincronização de áudio                | Pendente  |
| M08   | Save states versionados e slots                     | Pendente  |
| M09   | Interface completa, controles e acessibilidade      | Pendente  |
| M10   | Desempenho móvel e beta pública                     | Pendente  |
| M11   | Rewind com memória limitada                         | Pendente  |
| M12   | MBC2, MBC3 com RTC e MBC5                           | Pendente  |
| M13   | Painel técnico completo                             | Pendente  |
| M14   | Release, README, portfólio e material para LinkedIn | Pendente  |

## Primeiro ponto de revisão

Pausar após M02, sem iniciar M03. O proprietário testa a interface, o carregamento de cartuchos e a CPU. Jogos ainda não terão vídeo ou áudio nesse ponto.

O cartucho sintético POCKET TEST permite testar CPU, memória e serial sem obter jogos. O [README](../README.md#testar-o-primeiro-grupo-de-milestones) explica o roteiro de teste. Interrupções avançadas, incluindo retorno de EI seguido de HALT com interrupção pendente, e STOP completo continuam previstos para M03.

Cada milestone recebe um commit, com título Conventional Commits em inglês e corpo em pt-br. Sem autoria ou coautoria de ferramentas de IA e sem caracteres de travessão.

## Critérios de qualidade

- Tipos, lint, formatação, regras de escrita e build aprovados.
- Núcleo sem dependências de navegador, verificado por configuração TypeScript própria.
- Testes determinísticos de instruções, memória e serial quando disponíveis.
- Testes de navegador para os fluxos implementados, incluindo viewport móvel.
- Informar resultados reais. Blargg, Mooneye e dmg-acid2 serão introduzidos depois com revisão, hash, licença e protocolo registrados.
- A demo pública só entra após MBC1, bateria e seus créditos estarem prontos.

## Escopo e metas

A beta da M10 terá demo, áudio, toque, teclado, gamepad, paletas, bateria e save states. O lançamento completo adiciona rewind, cartuchos ampliados e debugger.

Meta de demo pronta em três segundos em perfil de teste documentado. Medir velocidade real da emulação, áudio e memória em celular. Cloudflare Pages elimina cold start de servidor, mantendo os custos normais de rede e inicialização no navegador.

Direção visual: bancada de cartuchos, papel quente, grafite, cinza mineral e violeta fechado apenas em ações e foco. Interface responsiva, contraste, teclado, áreas de toque confortáveis e movimento reduzido.

Previsão inicial: 10 a 16 semanas para beta e 16 a 24 para escopo completo, com 10 a 15 horas semanais. Reavaliar após CPU e timing. GBC, contas, backend, multiplayer e sincronização em nuvem ficam fora do V1.

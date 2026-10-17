# Decisões de arquitetura

## Um pacote e núcleo independente

O V1 usa um repositório e um pacote npm, sem monorepo. React, Vite e CSS Modules atendem à interface; TypeScript estrito também verifica o núcleo separadamente. Separar pacotes agora acrescentaria manutenção sem uma necessidade de distribuição independente.

`src/core` contém CPU SM83, bus, cartuchos, timer, DMA, joypad, serial, PPU e APU. Não importa DOM, React, Web Audio, armazenamento ou relógios do navegador. Testes do núcleo rodam em Node. T-cycles são a unidade de tempo: quatro equivalem a um M-cycle, e a frequência DMG é 4.194.304 T-cycles/s.

## Execução e apresentação

A máquina roda em Web Worker para liberar a interface. React envia comandos e exibe cópias dos dados. Arrays tipados, buffers reutilizados e filas limitadas controlam o uso de memória; evitar alocações no caminho quente continua sendo uma regra de implementação.

| Decisão                                      | Motivo e consequência                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Sem áudio, orçamento por relógio monotônico  | Mantém o avanço da máquina independente da renderização React.                                                                 |
| Com áudio, AudioWorklet solicita PCM estéreo | A taxa real da saída controla a cadência, evitando dois relógios concorrentes.                                                 |
| MessageChannel e buffers transferíveis       | Dispensa SharedArrayBuffer e COOP/COEP. Worker e Worklet usam filas limitadas.                                                 |
| Reserva PCM adaptativa                       | Repõe o déficit e prevê consumo durante o transporte. Protege a música sob jitter, com custo de latência de entrada.           |
| Captura no VBlank e em mudanças do LCD       | Preserva imagens intermediárias mesmo quando um lote de áudio executa vários quadros.                                          |
| Apresentação pelo cursor PCM                 | O requestAnimationFrame mostra a imagem mais recente cujo instante foi alcançado pelo áudio. Imagens futuras aguardam na fila. |

O transporte PCM admite uma demanda pendente e tem capacidade de 32.768 frames estéreo, em uma arena fixa de 256 KiB. A reserva começa em aproximadamente 64 ms e pode adaptar-se até 384 ms, respeitando a capacidade física. Cada pedido continua limitado a 16.256 frames, para preservar a fila de 16.384 frames da APU. O espaço adicional permite manter reserva e resposta em trânsito sem disputar o mesmo crédito. O pool de vídeo possui 64 buffers indexados de 160 por 144 pixels, totalizando 1.440 KiB, incluindo transferências em trânsito. Essa margem cobre a reserva PCM e imagens que ainda aguardam uma saída atrasada. Esgotar o pool descarta uma imagem, sem interromper a produção de PCM. Slot e token validam a devolução dos buffers.

Quando disponível, `getOutputTimestamp()` correlaciona os relógios de áudio e apresentação. O cliente usa `performance.now()` para consultar um histórico limitado de trechos de avanço e silêncio no instante estimado da saída. Assim, esvaziamento e reposição preservam o movimento que ainda está a caminho do alto-falante. A última correlação válida sobrevive a falhas temporárias. Timestamps iniciais zerados aguardam até um segundo; o fallback usa `AudioContext.currentTime` e preserva a escolha nessa geração após avançar. O cursor permanece monotônico por geração e limitado ao PCM disponível. A estimativa não comprova sincronismo acústico exato, especialmente com Bluetooth. Não se somam arbitrariamente `baseLatency` e `outputLatency`.

Gerações monotônicas de áudio invalidam mensagens antigas, inclusive ao reutilizar uma saída para outro cartucho. Conexão e escolha da geração ocorrem atomicamente no Worker. Pausa, carregamento de estado e rewind descartam imagens futuras e PCM antigo. Silenciar muda o ganho e mantém o caminho de áudio ativo. Ativação exige gesto do usuário e AudioWorklet em HTTPS ou localhost.

## Persistência e rewind

Bateria e três slots por cartucho ficam no IndexedDB, identificados pelo SHA-256 da ROM. Preferências versionadas ficam no localStorage. Tudo pertence ao navegador e à origem do site, sem upload ou sincronização em nuvem.

O arquivo `.pocketstate` é JSON versionado, limitado a 1 MiB, com modelo, identidade da ROM e checksum. Inclui a máquina e suas fases internas, sem incluir a ROM ou as filas PCM. A restauração valida uma máquina candidata antes de alterar a atual e termina em pausa. Checksum identifica corrupção; a validação estrutural continua obrigatória.

Rewind guarda até 20 segundos, aproximadamente 10 capturas por segundo emulado, numa arena de 8 MiB com checkpoints de até 256 KiB. Esse limite cobre os buffers do histórico, não o consumo total da aba. O histórico é temporário. Voltar também restaura RAM e RTC; somente o ponto final é enviado à persistência da bateria, e a gravação conclui antes de liberar os controles.

O RTC avança por T-cycles no núcleo. Tempo offline é calculado pelo adaptador somente ao reabrir a bateria, respeitando halt. Estados e rewind preservam o instante capturado, sem compensação offline. Consulte [cartuchos](cartridges.md).

## Inspeção, controles e diagnóstico

A inspeção lê CPU, desassemblador, memória, tiles, OAM e registradores sem avançar a máquina ou consumir serial e PCM. Consultas são limitadas e só ocorrem com o painel aberto e a página visível. Durante reprodução com áudio, o núcleo pode estar adiantado em relação à tela pela reserva PCM; pause para comparar ambos no mesmo instante.

Teclado, toque e gamepad mantêm fontes de entrada independentes. Pausa, perda de foco e página oculta liberam entradas; a aba oculta pausa o jogo. Foco visível, contraste, movimento reduzido e alvos de toque fazem parte do contrato da interface.

O diagnóstico separa T-cycles executados de imagens realmente desenhadas e mede janelas de 60 segundos. Registra também imagens recebidas e pendentes, cursor PCM, referência de relógio, correlação de saída e intervalos entre desenhos; pausas e novas gerações reiniciam a cadência observada. O JSON exportado contém métricas, sem ROM, memória ou progresso. Mudanças de geração, pausa e rewind interrompem janelas incompatíveis. Consulte [validação técnica](test-roms.md).

## Limites e publicação

O perfil é Game Boy DMG com inicialização pós boot, sem boot ROM original. A PPU renderiza por scanline, sem pixel FIFO, mudanças dentro do modo 3 ou peculiaridades de WX 0 e 166. Game Boy Color exclusivo, link cable e equivalência analógica integral ficam fora do escopo.

O deploy é estático no Cloudflare Pages Free, sem backend ou processo de servidor para iniciar na visita. Download e inicialização no navegador continuam existindo. CSP e cache são definidos em `public/_headers`; recursos da aplicação são servidos na mesma origem. Viewport móvel simulada não homologa desempenho no aparelho físico. Consulte [deploy](deployment.md) e [créditos](third-party.md).

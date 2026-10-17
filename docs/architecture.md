# Decisões de arquitetura

## Um pacote e núcleo independente

O V1 usa um repositório e um pacote npm, sem monorepo. React, Vite e CSS Modules atendem à interface; TypeScript estrito também verifica o núcleo separadamente. Separar pacotes agora acrescentaria manutenção sem uma necessidade de distribuição independente.

`src/core` contém CPU SM83, bus, cartuchos, timer, DMA, joypad, serial, PPU e APU. Não importa DOM, React, Web Audio, armazenamento ou relógios do navegador. Testes do núcleo rodam em Node. T-cycles são a unidade de tempo: quatro equivalem a um M-cycle, e a frequência DMG é 4.194.304 T-cycles/s.

## Execução e apresentação

A máquina roda em Web Worker para liberar a interface. React envia comandos e exibe cópias dos dados. Arrays tipados, buffers reutilizados e filas limitadas controlam o uso de memória; evitar alocações no caminho quente continua sendo uma regra de implementação.

| Decisão                                | Motivo e consequência                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Relógio monotônico com e sem áudio     | O Worker usa passos de aproximadamente 8 ms; pedidos PCM não executam T-cycles adicionais.              |
| AudioWorklet consome PCM já produzido  | O produtor responde parcialmente ou aguarda o próximo tick, sem bloquear entrada ou antecipar o jogo.   |
| MessageChannel e buffers transferíveis | Dispensa SharedArrayBuffer e COOP/COEP. Worker e Worklet usam filas limitadas.                          |
| Reserva PCM adaptativa                 | Protege a música sob jitter; a latência fica no som, sem reter a apresentação visual.                   |
| Captura no VBlank e em mudanças do LCD | Mantém as imagens e transições do núcleo observáveis sem alterar seu comportamento.                     |
| Apresentação interativa                | O Canvas recebe cada quadro atual assim que ele chega; o RAF consulta o cursor audível sem reter vídeo. |

O produtor e o consumidor possuem, cada um, uma arena fixa de 32.768 frames estéreo, ou 256 KiB. O produtor drena a APU após cada orçamento curto e guarda PCM já emulado. Uma demanda pendente devolve até 16.256 frames disponíveis; sem amostras, aguarda o próximo tick. Cada resposta pode ser parcial, sem preenchimento artificial com silêncio. Overflow no produtor descarta as amostras mais antigas e contabiliza a perda no diagnóstico.

A reserva do consumidor começa em aproximadamente 64 ms e pode adaptar-se até aproximadamente 384 ms, respeitando sua capacidade física. Ela cobre jitter e consumo durante o transporte sem obrigar a máquina a calcular o futuro. O pool de vídeo possui 64 buffers indexados de 160 por 144 pixels, totalizando 1.440 KiB, incluindo transferências em trânsito. Ele absorve atrasos da interface; as imagens já recebidas não aguardam o alto-falante. Esgotar o pool descarta uma imagem sem interromper a produção PCM. Slot e token validam a devolução.

Quando disponível, `getOutputTimestamp()` estima o cursor audível para diagnóstico, sem comandar a tela. `performance.now()` consulta um histórico limitado de trechos de avanço e silêncio no instante estimado da saída. A última correlação válida sobrevive a falhas temporárias. Timestamps iniciais zerados aguardam até um segundo apenas nessa estimativa; o fallback usa `AudioContext.currentTime` e preserva a escolha nessa geração após avançar. O cursor permanece monotônico por geração e limitado ao PCM disponível. Não se somam arbitrariamente `baseLatency` e `outputLatency`.

A saída física e a reserva podem fazer o som chegar depois da imagem. Executar grandes lotes de CPU para abastecer o áudio e reter o vídeo até a saída sonora acumularia latência na resposta visual aos controles. O relógio interativo independente evita esse acoplamento e mantém o cursor de saída apenas como informação. Não há promessa de sincronismo acústico exato nem de latência física uniforme entre dispositivos.

Gerações monotônicas de áudio invalidam mensagens antigas, inclusive ao reutilizar uma saída para outro cartucho. Conexão e escolha da geração ocorrem atomicamente no Worker. Pausa, carregamento de estado e rewind descartam imagens futuras e PCM antigo. Silenciar muda o ganho e mantém o caminho de áudio ativo. Ativação exige gesto do usuário e AudioWorklet em HTTPS ou localhost.

## Persistência e rewind

Bateria e três slots por cartucho ficam no IndexedDB, identificados pelo SHA-256 da ROM. Preferências versionadas ficam no localStorage. Tudo pertence ao navegador e à origem do site, sem upload ou sincronização em nuvem.

O arquivo `.pocketstate` é JSON versionado, limitado a 1 MiB, com modelo, identidade da ROM e checksum. Inclui a máquina e suas fases internas, sem incluir a ROM ou as filas PCM. A restauração valida uma máquina candidata antes de alterar a atual e termina em pausa. Checksum identifica corrupção; a validação estrutural continua obrigatória.

Rewind guarda até 20 segundos, aproximadamente 10 capturas por segundo emulado, numa arena de 8 MiB com checkpoints de até 256 KiB. Esse limite cobre os buffers do histórico, não o consumo total da aba. O histórico é temporário. Voltar também restaura RAM e RTC; somente o ponto final é enviado à persistência da bateria, e a gravação conclui antes de liberar os controles.

O RTC avança por T-cycles no núcleo. Tempo offline é calculado pelo adaptador somente ao reabrir a bateria, respeitando halt. Estados e rewind preservam o instante capturado, sem compensação offline. Consulte [cartuchos](cartridges.md).

## Inspeção, controles e diagnóstico

A inspeção lê CPU, desassemblador, memória, tiles, OAM e registradores sem avançar a máquina ou consumir serial e PCM. Consultas são limitadas e só ocorrem com o painel aberto e a página visível. Tela e inspeção chegam por mensagens independentes; pause para comparar ambas no mesmo instante.

Teclado, toque e gamepad mantêm fontes de entrada independentes. Pausa, perda de foco e página oculta liberam entradas; a aba oculta pausa o jogo. Foco visível, contraste, movimento reduzido e alvos de toque fazem parte do contrato da interface.

O diagnóstico separa T-cycles executados de imagens realmente desenhadas e mede janelas de 60 segundos. Registra filas e perdas do produtor e consumidor PCM, imagens recebidas e pendentes, cursor audível, referência de relógio, correlação de saída e intervalos entre desenhos. Essas amostras são periódicas e não comprovam latência entre toque e pixel. Pausas e novas gerações reiniciam a cadência observada; pausa e rewind interrompem janelas incompatíveis. O JSON contém métricas, sem ROM, memória ou progresso. Consulte [validação técnica](test-roms.md).

## Limites e publicação

O perfil é Game Boy DMG com inicialização pós boot, sem boot ROM original. A PPU renderiza por scanline, sem pixel FIFO, mudanças dentro do modo 3 ou peculiaridades de WX 0 e 166. Game Boy Color exclusivo, link cable e equivalência analógica integral ficam fora do escopo.

O deploy é estático no Cloudflare Pages Free, sem backend ou processo de servidor para iniciar na visita. Download e inicialização no navegador continuam existindo. CSP e cache são definidos em `public/_headers`; recursos da aplicação são servidos na mesma origem. Viewport móvel simulada não homologa desempenho no aparelho físico. Consulte [deploy](deployment.md) e [créditos](third-party.md).

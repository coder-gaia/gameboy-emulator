# MB01: lentidão mobile depois de ativar o som

Registro da revisão do proprietário em 16 de outubro de 2026, no fuso America/Sao_Paulo. Estado observado: commit `d41d9b32bcb376f7d1c6ab5bf432c860b4fcb15f`, publicado na [beta](https://gameboy-emulator-aox.pages.dev/).

**Prioridade alta. O diagnóstico de 16 de outubro não alterou a implementação. A sessão de 17 de outubro iniciou a M12, incluindo a correção e as setas maiores. A homologação com áudio no Motorola permanece pendente.**

## Relato confirmado

- Desktop aprovado pelo proprietário.
- No Motorola Edge 40 Neo, usando Chrome, os três cartuchos ficam fluidos antes de ativar o som.
- Depois de **Ativar som**, Tobu Tobu Girl aparenta parar nos créditos `sound by potato-tan`, com música picotada. 2048 movimenta as peças lentamente; o jardim também movimenta o personagem lentamente.
- O proprietário aprovou a jogabilidade e pediu setas de toque maiores. Esse ajuste entra no mesmo lote.
- Versões do Chrome e do sistema, taxa de áudio, saída utilizada e estado de economia de energia ainda não foram coletados.

O relato isola a ativação do áudio como gatilho. Não comprova uma falha específica da ROM de Tobu nem insuficiência geral do núcleo sem áudio. Uma imagem parada nos créditos também não comprova deadlock: precisamos observar se os T-cycles continuam crescendo devagar.

## Mecanismo encontrado no código da M11

1. Sem saída de som, `clock()` em `src/runtime/emulator.worker.ts` avança a máquina por tempo monotônico.
2. Ao conectar áudio, o Worker encerra esse timer e passa a avançar a máquina somente quando o Worklet solicita PCM, em `onAudio()`.
3. `src/platform/audio/pcm-stream.ts` permite apenas um pedido pendente. Depois de preencher a reserva inicial, solicita sempre 512 frames por reposição, mesmo quando a fila esvazia.
4. `src/platform/audio/protocol.ts` define reposição de 512 frames e alvo de 1536 frames. Em 48 kHz, representam aproximadamente 10,67 ms e 32 ms de áudio, respectivamente. A taxa real do Motorola ainda não foi medida.
5. Se o ciclo pedido, produção e entrega sustentar um intervalo maior que a duração de cada reposição, a máquina inteira avança abaixo de 1x. Quando falta PCM, `pcm-queue.ts` preenche a saída com silêncio e registra underruns.

Exemplo teórico: uma reposição de 512 frames a cada 50 ms, em 48 kHz, só sustenta cerca de 0,21x. Aumentar apenas a reserva inicial não altera essa vazão sustentada. O Worker também rejeita pedidos acima de 4096 frames; qualquer alteração deve respeitar ou revisar esse limite explicitamente.

A APU já executa sem saída de som. Ativar o áudio não acrescenta os quatro canais pela primeira vez. A diferença relevante é a troca da fonte de cadência e a entrega de PCM.

**Silenciar não desliga esse caminho.** O botão apenas altera o ganho. Depois de ativar som em Tobu, trocar para 2048 ou jardim reconecta o áudio ao novo Worker. Para comparar sem áudio, comece por uma página nova antes de ativar o som.

## Reprodução controlada

Foi executado um diagnóstico sobre os assets públicos, em Chromium 156.0.8078.4 no Ryzen 7 5700U, com viewport Pixel 7 e rewind desligado. Cada jogo usou um contexto novo. O código de diagnóstico comparou o transporte direto com uma ponte que acrescenta um temporizador de 10 ms em cada sentido das mensagens de áudio.

| Condição          | Jardim, velocidade | Tobu, velocidade | Frames de áudio ausentes |
| ----------------- | -----------------: | ---------------: | -----------------------: |
| Direto, sem áudio |            100,11% |          100,06% |            Não aplicável |
| Direto, com áudio |            100,06% |          100,08% |                       0% |
| Ponte, sem áudio  |            100,13% |          100,09% |            Não aplicável |
| Ponte, com áudio  |             33,33% |           33,43% |      Aproximadamente 67% |

As janelas foram de oito segundos sem áudio e doze com áudio. A velocidade usa a diferença real de T-cycles dividida por 4.194.304 e pelo tempo transcorrido. A falta de áudio usa a diferença de `underrunFrames` dividida pela soma de frames apresentados e ausentes. O jardim gera PCM silencioso; seus underruns medem abastecimento, não música.

Esse ensaio reproduziu a combinação de execução fluida sem som e lentidão após ativá-lo. Ele demonstra a sensibilidade do protocolo à entrega atrasada. **Não mede a latência do Motorola nem confirma sua causa exata.** A ponte acrescenta saltos de mensagem e temporizadores; o atraso nominal inserido não é uma medição do tempo total de ida e volta. As janelas incluem abertura e menus, não constituem benchmark de gameplay.

Dados e amostras estão em [resultados da investigação](mobile-audio-diagnosis-results.json). Scripts e capturas locais: `.work/mobile-runtime-diagnosis.ts` e `.work/mobile-runtime-diagnosis/`. O navegador de diagnóstico foi encerrado ao concluir.

## Por que os testes anteriores passaram

O descritor Pixel 7 testa viewport, toque e outras propriedades de navegador no computador. Não executa em um Pixel 7 físico. [Emulação do Playwright](https://playwright.dev/docs/emulation).

O benchmark M10 aplicou `Emulation.setCPUThrottlingRate` à sessão da página. Um experimento adicional com carga fixa aquecida, três amostras por condição e checksums iguais confirmou o alcance neste Chromium:

| Mediana da carga | Página 1x | Página 4x |
| ---------------- | --------: | --------: |
| Thread da página |   99,6 ms |  466,2 ms |
| DedicatedWorker  |   99,6 ms |   99,6 ms |

Enviar o comando diretamente ao target Worker retornou `Operation is only supported for pages, not workers`. O experimento não equivale ao telefone. A implementação do Chromium limita esse comando à página e utiliza um throttler de main thread. [InspectorEmulationAgent](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/inspector/inspector_emulation_agent.cc), [ThreadCPUThrottler](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/scheduler/public/thread_cpu_throttler.h).

Além disso, `tests/production/bench-browser.spec.ts` registra velocidade e underruns, mas só exige progresso dos T-cycles e presença de PCM. Não reprova velocidade abaixo de 1x ou cortes de áudio. O benchmark é separado da suíte normal de produção. Os testes de áudio e smoke verificam funcionalidade e limites de fila, sem garantir reprodução contínua no aparelho.

Os resultados históricos M10 permanecem válidos para o ambiente registrado. Eles não homologam desempenho neste Motorola. O aceite mobile está pendente.

## Hipóteses a distinguir no aparelho

- Latência de mensagens e apenas uma reposição pequena pendente limitam a vazão sustentada.
- Callbacks de áudio em rajadas podem consumir vários quanta antes da entrega de novas mensagens.
- A reserva em frames pode representar tempo insuficiente na taxa real de amostragem.
- Custo do handler do Worker, do Worklet, da drenagem PCM ou de alocações pode consumir a folga restante.

Mensagens assíncronas merecem atenção em áudio de tempo real; a documentação do Chrome discute latência e alocação nesse desenho. A especificação também distingue render quantum do buffer nativo da saída. São referências para investigação, não prova da causa no aparelho. [Audio Worklet design pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern/), [Web Audio rendering loop](https://www.w3.org/TR/webaudio/#rendering-loop).

## Plano registrado em 16 de outubro para M12 a M14

1. Começar M12 pela reprodução no Edge 40 Neo com Chrome, jardim e rewind desligado. Registrar versões, `sampleRate`, `baseLatency` e `outputLatency` disponíveis, saída de áudio e economia de energia.
2. Medir T-cycles por tempo real, crescimento de frames, estado da máquina, intervalo entre pedidos PCM, tamanho dos lotes, tempo de serviço no Worker e tempo de ida e volta observado pelo Worklet. Não subtrair relógios de contextos diferentes sem normalizá-los.
3. Medir fila, priming, underruns, descarte e cadência do AudioContext. Separar custo de cálculo de espera por entrega ou callback. Usar profiling do Worker quando necessário; o comando de CPU throttle testado não serve para desacelerá-lo diretamente.
4. Corrigir o abastecimento e a cadência conforme as medidas. Avaliar reposição proporcional ao déficit, lotes e reserva definidos em tempo, com limites de memória e de pedidos. Não escolher a solução apenas aumentando um número fixo. Preservar clock DMG, T-cycles, fases da APU, epochs, pausa, estados e rewind.
5. Acrescentar regressão que injete atraso controlado na entrega de áudio e exija velocidade sustentada e abastecimento adequados. Testar taxas suportadas e pedidos inválidos, com limites explícitos. Manter os testes externos de precisão.
6. Ampliar as setas de toque no mobile, incluindo área útil e ícones. Hoje cada alvo tem 44 por 44 CSS px e o ícone tem 18 px. A proposta inicial é aproximadamente 52 px por alvo e 22 px por ícone quando houver espaço. Ajustar layout em 320 px e tela cheia para preservar alvos acessíveis, sem recorte ou sobreposição. Manter o desktop aprovado e os gestos simultâneos de direcional e A/B.
7. Seguir as entregas já previstas de cartuchos na M12, painel técnico na M13 e release na M14. A correção mobile entra neste mesmo lote de três milestones e deve ser validada antes do lançamento. Não adicionar uma quarta milestone ao grupo.

Como proposta de aceite, medir janelas de 60 segundos depois do aquecimento, com e sem áudio, nos três cartuchos, e uma sessão sustentada de cinco minutos com áudio. A meta é velocidade entre 98% e 102% por janela, sem cortes audíveis, sem frames PCM ausentes ou descartados na janela estável, e produção suficiente para acompanhar a saída. Registrar amostras por segundo para não esconder pausas na média. Esses são critérios propostos, não resultados já obtidos no telefone.

Repetir pausa, retomada, mute, volume, troca de cartucho, slots, importação de estado e rewind com áudio. Confirmar também a continuidade dos saves. A versão final deve passar em desktop e no Motorola; o perfil simulado continua complementar.

## Implementação da M12 em andamento

Esta seção registra o código preparado em 17 de outubro de 2026. As seções anteriores preservam o diagnóstico e as medições de 16 de outubro, realizados sobre a M11. A implementação atual trata a sensibilidade ao transporte atrasado; ainda não confirma a origem da latência no Motorola nem constitui homologação do aparelho. O [roteiro M12 a M14](testing-m12-m14.md) separa a revisão manual dos testes simulados.

O áudio continua controlando a cadência da máquina quando está conectado. O clock DMG de 4.194.304 T-cycles por segundo, as fases da APU e o caminho sem saída de som permanecem como referências. O ajuste muda o abastecimento entre Worker e Worklet:

1. `audioBufferProfile(sampleRate)`, em `src/platform/audio/protocol.ts`, calcula uma reserva inicial nominal de 64 ms, reposição mínima nominal de 10 ms e teto temporal nominal de 128 ms. Os valores são alinhados para cima em quanta de 128 frames; por isso, a duração efetiva pode superar ligeiramente o valor nominal. A taxa aceita é inteira, de 8.000 a 192.000 Hz.
2. A fila continua fixa em 16.384 frames estéreo. Pedidos e alvo são limitados a 16.256 frames, deixando margem de 128 frames para o excedente de produção permitido pelo protocolo. O Worker valida cada orçamento conforme o perfil da taxa conectada. Não há crescimento ilimitado de fila ou pedidos.
3. `PcmStream.demand()` mantém somente um pedido pendente e solicita o déficit completo mais o consumo em voo previsto pelo maior RTT observado na geração atual. Depois do priming, déficits menores que a reposição mínima aguardam mais consumo. Durante priming ou rebuffer, não antecipa consumo e até um déficit pequeno pode ser solicitado para completar o alvo. O pedido respeita o perfil e o crédito físico `16.256 - queuedFrames`, incluindo margem para overshoot, mesmo se a resposta chegar antes do previsto. A reposição deixa de ser sempre um lote fixo de 512 frames.
4. O Worklet mede a ida e volta em frames que ele próprio processou entre pedido e resposta, em `roundTripFrames`. Não subtrai timestamps de threads diferentes. Esse contador descreve o avanço do fluxo de áudio durante a espera; não separa sozinho cálculo, entrega de mensagens e escalonamento do sistema.
5. Ao receber PCM válido, o alvo passa a ser o maior entre o alvo atual e `2 * roundTripFrames + 2 * renderQuantumFrames`, limitado pelo teto do perfil. `renderQuantumFrames` retém o maior quantum observado na geração atual. O alvo pode crescer durante a sessão e volta ao perfil inicial quando a geração é reiniciada.
6. Uma resposta não vazia pode provocar novo pedido imediatamente se ainda faltar PCM, incluindo o preenchimento do alvo adaptado. Se faltar áudio depois da primeira saída, o fluxo volta a aguardar reserva antes de consumir. Os frames silenciosos desse rebuffer entram em `underrunFrames` e `underruns`, além das faltas detectadas pela fila. O priming inicial, antes de qualquer reprodução, fica separado desse contador; deve ficar fora da janela estável de medição e ser descrito no aquecimento.
7. Resets de geração, identificados por `epoch`, descartam fila, pedido pendente e medições anteriores. Respostas antigas, sem pedido, com quantidade inválida de amostras ou acima da margem são recusadas. Pausa, restauração e rewind continuam usando esse isolamento para impedir reprodução de trechos antigos.
8. PCM vazio válido encerra o pedido pendente, mas não dispara uma nova solicitação dentro do mesmo handler de mensagem. O Worklet aguarda o próximo callback de renderização para pedir novamente. Isso evita uma sequência contínua de mensagens vazias, por exemplo quando a máquina está em STOP.

Em 48 kHz, os perfis inicial e máximo correspondem exatamente a 3.072 frames e 6.144 frames, ou 64 ms e 128 ms. Em 44,1 kHz, o alinhamento produz 2.944 e 5.760 frames, aproximadamente 66,8 ms e 130,6 ms. Em 192 kHz, o limite de 16.256 frames prevalece e reduz o teto efetivo para aproximadamente 84,7 ms. A reserva oferece tolerância a atrasos finitos; não garante áudio contínuo se produção e entrega não acompanharem o consumo sustentado.

As regressões preparadas incluem transporte atrasado e callbacks em rajadas em `tests/unit/audio-mobile-flow.test.ts`, exercício de Worker e AudioWorklet reais com atraso controlado em `tests/audio-mobile/audio-flow.spec.ts` e alvos de toque em `tests/e2e/touch-controls.spec.ts`. A existência desses casos não declara aprovação da suíte completa da M12. Resultados do fechamento da milestone devem ser registrados somente depois da execução correspondente.

Velocidade emulada e frequência de apresentação são medidas diferentes. O Worker publica ao terminar cada orçamento; um lote de PCM maior pode representar vários quadros emulados, com apenas o último apresentado. O delta de `frameId` não mede FPS do Canvas. O aceite no telefone deve considerar fluidez visual e resposta aos controles, além da velocidade por T-cycles e da continuidade do áudio.

### Consumo durante a resposta

Uma revisão intermediária da M12 já recuperava velocidade de 99,14% a 100,40% nos seis cenários, mas falhou em continuidade de áudio em dois deles: Tobu mobile registrou 2.304 frames ausentes e 2048 mobile, 6.656. Eram janelas de 12 segundos após três segundos de aquecimento, no Chromium do computador com a ponte de atraso. As histórias recuperadas dos traces mostraram filas de 256 ou 512 frames, RTT de 1.536 frames e picos posteriores; em 2048 houve uma amostra de RTT de 3.584 frames, cerca de 74,7 ms em 48 kHz. A reserva atingiu o limite de 6.144 frames. Não são medidas do telefone.

O déficit simples `T - Q` não inclui os frames consumidos enquanto o pedido viaja. Com alvo `T`, fila `Q` e atraso observado `R`, a fila na chegada tende a `T - R`. Duas respostas consecutivas podem deixar um mínimo de `T - R_anterior - R_atual`, com pouca margem para variação. A correção acrescenta o consumo previsto em voo durante a reprodução, buscando retornar ao alvo na chegada. Usa o pico de RTT da geração para que uma resposta rápida isolada não remova a proteção antes de outra lenta. O crédito físico protege a fila quando o atraso cai.

O alvo continua limitado a aproximadamente 128 ms, mas não limita a ocupação efetiva: a compensação conservadora pode entregar PCM acima dele quando a resposta chega cedo. A simulação de jitter em 48 kHz alcançou 9.600 frames, ou 200 ms, mantendo a fila física de 16.384 frames. Isso implica maior latência em troca da continuidade. Pausa e reconexão limpam a estimativa. Em 192 kHz, os mesmos buffers cobrem apenas cerca de 85 ms; não se promete continuidade sob atrasos arbitrários nessa taxa. Os testes exigem memória limitada, recuperação e ausência de descarte, com continuidade nos cenários que cabem nessa janela.

As setas de toque recebem alvos de 52 por 52 CSS px e ícones de 22 px em ponteiros coarse quando há espaço. Em 320 px, os alvos preservam o mínimo de 44 por 44 px e usam os ícones maiores. O desktop com ponteiro fino mantém 44 px e ícones de 18 px. O layout de tela cheia reserva espaço para o rodapé em duas linhas quando necessário. Os handlers de pressão, captura de ponteiro e fontes simultâneas foram preservados.

### Resultado automatizado da correção definitiva

A coleta isolada final passou nos seis cenários, com três segundos de aquecimento e janelas estáveis de 12 segundos. Velocidades: jardim 100,12%, Tobu 99,49% e 2048 99,30% no desktop; jardim 100,24%, Tobu 99,91% e 2048 99,98% no perfil Pixel 7 simulado. Todos tiveram zero frames PCM ausentes e zero descartados nessas janelas. A ponte nominal de 10 ms por sentido apresentou máximos observados de 72,8 a 99,0 ms; o maior RTT amostrado pelo Worklet foi 4.864 frames, cerca de 101,3 ms. A ocupação amostrada chegou a 8.320 frames, cerca de 173,3 ms, acima do alvo e dentro da arena física.

O [relatório final](performance-audio-mobile-results.json) conserva dados, hashes, distribuições e limitações. Os relógios da ponte e do Worklet descrevem intervalos distintos e não são subtraídos entre si. As amostras de 250 ms podem perder picos. Houve uma coleta anterior com carga concorrente que apresentou cortes e conflito de limpeza de traces; ela não compõe o aceite isolado. Os traços determinísticos de jitter também passaram após a compensação por pico. Não se alteraram os critérios para transformar falha em sucesso.

**Estado do aceite:** regressão automatizada de áudio aprovada no computador; teste de áudio e velocidade no Motorola Edge 40 Neo com Chrome ainda não executado nesta revisão. Não substituir essa pendência por resultados de viewport Pixel 7, CPU throttle da página ou atraso sintético no computador.

## Biblioteca embutida

O V1 atualmente inclui Tobu Tobu Girl e 2048, além do jardim próprio de diagnóstico. O catálogo é extensível; esses dois não constituem um limite técnico permanente. Novas demos dependem de escolha de escopo, permissão clara de distribuição e registro de origem, licença, créditos e hashes. Esta investigação não acrescenta jogos ao catálogo.

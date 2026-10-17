# Desempenho e validação de produção

O Pocket Lab executa a máquina em um Web Worker e apresenta vídeo e controles na página. O AudioWorklet solicita PCM diretamente ao Worker quando o som está ativo. Sem som, a execução usa tempo monotônico com orçamento limitado. A aplicação não depende de um processo de servidor para emular o console.

## Reproduzir as medições

Com as dependências instaladas:

```powershell
npm.cmd run benchmark:core -- .work/core-benchmark.json
npm.cmd run build
npm.cmd run test:production
npm.cmd run benchmark:browser
```

O benchmark de núcleo compila o código para Node, prepara checkpoints determinísticos do jardim, 2048 e Tobu Tobu Girl, aquece cada cenário e mede cinco repetições. Calcula a velocidade pela quantidade real de T-cycles dividida por 4.194.304 e pelo tempo transcorrido. Restaurar checkpoints e calcular hashes ficam fora do intervalo medido. A APU continua gerando PCM mesmo quando a apresentação é descartada.

O benchmark de navegador usa o build estático servido com os mesmos cabeçalhos previstos para Cloudflare. Registra inicialização da interface e clique no jogo até o primeiro quadro separadamente. Mede uma janela de 30 segundos sem som e outra de 30 segundos com som em Tobu Tobu Girl. As observações vêm de Worker e AudioWorklet nativos; não há uma API de teste na aplicação.

O projeto `desktop` usa Chromium no computador de teste. O projeto `mobile` usa viewport e entrada do Pixel 7, com redução de CPU 4x pelo CDP na página. Isso é uma simulação relativa ao computador, não uma medição em um Pixel 7 físico. O alcance da redução sobre o Worker não é presumido. A rede é local, sem representar latência, compressão ou distribuição geográfica do CDN. [Limites da simulação](https://developer.chrome.com/docs/devtools/performance/reference), [comando de redução de CPU](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setCPUThrottlingRate).

**Retorno do aparelho real:** o proprietário confirmou desktop fluido e, no Motorola Edge 40 Neo com Chrome, lentidão somente depois de ativar o som. O aceite mobile está pendente. Um experimento posterior confirmou que o throttle da página não desacelera o DedicatedWorker neste Chromium; outro reproduziu velocidade próxima de 33% e falta de PCM ao atrasar a entrega de mensagens de áudio, mantendo velocidade normal sem áudio. Isso sustenta a investigação da cadência, sem confirmar a causa específica no telefone. Os testes funcionais existentes também não exigem velocidade mínima ou ausência de underruns. Consulte [diagnóstico MB01](mobile-audio-investigation.md) e [resultados controlados](mobile-audio-diagnosis-results.json). Os números históricos abaixo descrevem o ambiente original e não constituem homologação nesse aparelho.

Os relatórios de navegador são anexados aos resultados em `.work/benchmark-browser`. Eles registram ambiente, perfil, T-cycles, tempo, quadros observados e estatísticas PCM. Execute benchmarks sem outras tarefas intensivas de CPU; não use o tempo de execução de uma suíte concorrente como resultado de desempenho.

## Medição do núcleo na M10

Medição em 16 de outubro de 2026, Windows x64, Ryzen 7 5700U, Node 22.13.0 e V8 12.4. Cada execução parte do mesmo checkpoint e usa dois aquecimentos e cinco repetições de 120 frames. A comparação abaixo usa a passagem identificada B, executando o otimizado antes do original para conferir que o ganho não depende de aquecer somente a segunda versão.

| Cenário        | Original, mediana | M10, mediana | Original, pior | M10, pior |
| -------------- | ----------------: | -----------: | -------------: | --------: |
| Jardim         |            5,063x |       8,202x |         4,516x |    7,030x |
| 2048           |            5,037x |       8,169x |         4,901x |    8,104x |
| Tobu Tobu Girl |            5,226x |       5,656x |         5,217x |    5,644x |

O bus passou a avançar cada periférico por um método unitário interno, mantendo validação dos orçamentos nas APIs públicas e a mesma ordem dos T-cycles. A APU recalcula o mixer quando a amplitude muda; timers, canais, amostrador e filtro continuam avançando. Os hashes dos estados finais e das sequências PCM completas foram idênticos nos três cenários. Nenhum campo obrigatório ou versão dos estados salvos foi alterado.

O [relatório completo do núcleo](performance-core-results.json) preserva todas as amostras dessa comparação, ambiente, buffers conhecidos e identificação SHA-256 dos bundles executados. O hash da árvore do worktree descreve os arquivos presentes; os hashes compilados distinguem o código original preservado do otimizado executado no mesmo checkout.

## Medição do navegador na M10

O mesmo computador executou Chromium 156 e o build de produção com cache desativado em loopback. Tobu Tobu Girl estava em fase jogável antes das duas janelas de 30 segundos. O áudio utilizou AudioContext e AudioWorklet nativos.

| Perfil                          | Interface inicial | Clique até primeiro quadro | Velocidade sem som | Velocidade com som | Underruns na janela com som |
| ------------------------------- | ----------------: | -------------------------: | -----------------: | -----------------: | --------------------------: |
| Desktop                         |            201 ms |                      97 ms |             99,94% |            100,04% |                           0 |
| Pixel 7 simulado, página CDP 4x |            823 ms |                     295 ms |            100,03% |            100,01% |                           0 |

Os dois perfis apresentaram cerca de 59,6 quadros observados por segundo e nenhuma amostra descartada nas janelas medidas. Esses números descrevem esse host, esse build e essa rede local. Não comprovam velocidade em aparelho físico nem tempo de abertura pela internet. O [relatório completo de navegador](performance-browser-results.json) registra ambiente, contadores, intervalos e limitações.

## Interpretar os resultados

Velocidade `1x` significa avançar um segundo do console em um segundo real. O benchmark de núcleo roda sem limitar a velocidade; o de navegador observa a reprodução, cuja meta é acompanhar `1x`. Um resultado de vários múltiplos no Node não garante o mesmo desempenho em outro processador ou navegador.

Quadros observados pela página não são uma comparação acústica ou um registro de cada quadro interno. O Worker pode publicar somente o quadro mais recente entre solicitações de áudio. As filas PCM são limitadas; os contadores de underrun mostram falta de amostras na apresentação durante a janela medida. Um resultado sem underruns nesse teste não garante ausência de cortes em qualquer dispositivo.

A meta de primeiro jogo pronto em até três segundos só pode ser avaliada no perfil e na origem descritos no relatório. Download inicial, inicialização do JavaScript e abertura do cartucho continuam existindo em hospedagem estática. A beta M10 também passou pelos testes funcionais no endereço público da Cloudflare, conforme [publicação validada](deployment.md); esses testes não substituem uma medição da rede de cada visitante.

## Rewind na M11

O ensaio isolado em Node neste computador alternou cinco pares de 25 segundos emulados, com rewind desligado e com captura a cada 0,1 segundo. Cada cenário também realizou 100 restaurações, medindo XOR, decodificação e `GameBoy.restoreState` completo. A validação segura usada nos estados externos foi preservada.

| Cenário            | Velocidade desligado | Velocidade ativo | Restore mediano | Restore p95 |
| ------------------ | -------------------: | ---------------: | --------------: | ----------: |
| Jardim             |               6,152x |           6,503x |        1,728 ms |    3,484 ms |
| Tobu Tobu Girl     |               4,920x |           4,872x |        3,068 ms |    4,363 ms |
| Fixture MBC1 2 MiB |               6,754x |           7,019x |       13,325 ms |   15,106 ms |

As faixas das amostras forward se sobrepõem. Valores maiores com rewind ativo não são tratados como ganho causado pelo recurso. Os hashes finais de estado e PCM foram iguais em todos os pares. O ensaio cobre o núcleo e o histórico, sem Worker, React, Canvas, Worklet ou hardware móvel; não comprova esses tempos em celulares.

Todos os cenários retiveram 201 pontos e 20 segundos ao fim da janela de 25 segundos. A arena reservou exatamente 8.388.608 bytes, incluindo seus buffers de trabalho. Os bytes utilizados foram 493.504 no jardim, 1.386.426 em Tobu e 507.904 na fixture MBC1. A ROM e a máquina atual ficam fora dessa arena; ela não limita toda a memória da aba. Outros padrões de alteração podem reduzir a duração disponível.

O [relatório de rewind](performance-rewind-results.json) preserva amostras, hashes, ambiente e escopo. Para reproduzir:

```powershell
npm.cmd run benchmark:rewind -- docs/performance-rewind-results.json
```

No produto, capturas ocorrem aproximadamente a 10 Hz nos limites dos orçamentos do Worker. A duração usa os timestamps reais em T-cycles. Consulte [funcionamento e limites](rewind.md).

## Memória e limites

A M12 acrescenta uma [regressão de transporte de áudio](performance-audio-mobile-results.json), executada isoladamente sobre o build congelado. Os seis cenários, cobrindo os três cartuchos em desktop e perfil Pixel 7 simulado, passaram com velocidade de 99,30% a 100,24% e zero frames PCM ausentes ou descartados nas janelas estáveis de 12 segundos. A compensação usa o pico de atraso observado na geração e crédito físico para proteger a fila. As medições anteriores da M10 e M11 permanecem históricas. Essa regressão não homologa o Motorola físico nem mede FPS de apresentação; consulte [diagnóstico, correção e limites MB01](mobile-audio-investigation.md).

O relatório do núcleo soma buffers tipados conhecidos da máquina, incluindo cópias internas da ROM, RAM, vídeo, fila PCM e serial. Isso não mede objetos JavaScript, snapshots temporários, UI, heap do Worker, heap da página ou memória interna do navegador. Não use `performance.memory` da página como consumo total do emulador.

A fila PCM do núcleo e do Worklet tem limites explícitos. Baterias de RAM simples são gravadas quando sua revisão muda. Cartuchos com RTC também atualizam o timestamp nos checkpoints, mesmo pausados, para preservar a fase e distinguir o tempo offline. Os slots persistidos são limitados a três por ROM e o formato de arquivo aceita no máximo 1 MiB. A página apresenta as cópias mais recentes sem executar a CPU dentro do React.

## Build e regressões

`npm.cmd run check` valida regras, formatação, lint, testes, tipos e build. A suíte de desenvolvimento cobre os fluxos detalhados da interface. `npm.cmd run test:production` verifica o artefato final, MIME, cache, CSP, Worker, áudio, demos, slots, arquivos, preferências e tela cheia. O CI também executa `test:audio-flow`, com atraso controlado entre Worker e Worklet, e os 103 testes externos de hardware. Essa regressão mede velocidade em T-cycles, frames PCM ausentes e descartados; viewport mobile não equivale a aparelho físico.

Os artefatos de QA em `.work` e `test-results` são ignorados pelo watcher do Vite, evitando recarregar a página por causa de um trace de teste. O servidor estático de QA aplica o subconjunto de `_headers` usado no projeto e não substitui a infraestrutura da Cloudflare. Consulte [preparação e publicação](deployment.md).

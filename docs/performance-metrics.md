# Diagnóstico de desempenho e áudio

O painel **Desempenho e áudio** fica na área técnica, ao lado de **Inspecionar CPU**. Os painéis são independentes: fechar a inspeção de CPU não encerra uma medição. O painel observa a máquina que já está executando e a saída de áudio local. Abrir o painel não cria outra instância do emulador.

## Como medir

1. Abra um jogo e mantenha a página visível. Para comparar sem áudio, recarregue a página antes de ativar o som. Silenciar altera o ganho e mantém o caminho de áudio ativo.
2. Para medir com som, ative a saída e aguarde dez segundos de aquecimento.
3. Abra o painel e escolha **Medir por 60 segundos**. Continue jogando sem pausar. O progresso termina automaticamente; **Encerrar medição** permite guardar uma janela menor.
4. Escolha **Exportar diagnóstico** para baixar `pocket-lab-diagnostico.json`.

Pausa, rewind, troca de geração da máquina ou do áudio, fechamento do painel e página oculta interrompem a janela. O relatório informa o motivo; intervalos interrompidos não recebem uma velocidade válida. Uma nova medição começa com novos contadores de referência.

O teste funcional que usa relógio manual no Playwright verifica o término de 60 segundos e o formato do arquivo. Ele altera o relógio da página e não acelera o Worker. Os 60 saltos de um segundo mantêm cada amostra do painel e agrupam callbacks de animação intermediários, evitando que milhares de callbacks artificiais consumam o orçamento da suíte. O avanço do Worker é comparado com o tempo real do processo de teste. Seus números não são um benchmark.

## O que os números representam

| Campo                         | Interpretação                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Velocidade emulada            | Diferença de T-cycles dividida por 4.194.304 e pelo tempo transcorrido na página, em porcentagem. Uma máquina que executa um segundo DMG por segundo observado registra 100%.         |
| Quadros desenhados/s          | Diferença do contador de imagens distintas enviadas ao Canvas por segundo. O contador vem do desenho da tela, não do crescimento de `frameId`. Não comprova a taxa física do monitor. |
| T-cycles observados           | Contador acumulado da máquina. Regressões e mudanças de geração invalidam a comparação entre pontos.                                                                                  |
| Taxa e estado do áudio        | Taxa de amostragem e estado informado pelo AudioContext. Antes da ativação, o painel informa que o som não foi ativado.                                                               |
| Fila PCM                      | Frames estéreo disponíveis e sua duração na taxa atual. A fila pode superar o alvo ao compensar consumo durante o transporte, dentro do limite físico do protocolo.                   |
| Alvo PCM                      | Reserva que o Worklet tenta manter. Não é uma medição completa de latência até o ouvido.                                                                                              |
| Ida e volta PCM               | Quantidade de frames transcorridos no Worklet entre uma demanda e sua resposta, convertida em tempo. Inclui espera e produção do PCM. Não compara relógios de threads diferentes.     |
| Maior ida e volta PCM         | Maior tempo de ida e volta observado na geração atual, usado para compensar consumo enquanto a resposta está em voo.                                                                  |
| Frames ausentes e descartados | Contadores acumulados da geração de áudio. Rebuffer após o primeiro priming também conta como falta real. O resumo do relatório usa diferenças apenas entre pontos compatíveis.       |
| Latência base e de saída      | Valores disponibilizados pelo navegador. Ausência de suporte aparece como `Indisponível` e é exportada como `null`. Não substituir ausência por zero.                                 |

O Worklet publica estatísticas periódicas e o painel coleta pontos aproximadamente a cada segundo. Valores instantâneos de fila podem perder picos entre coletas. Contadores cumulativos registram os totais da geração; o maior RTT conserva o pico observado pelo Worklet.

## Arquivo local

O JSON contém versão do formato, instante de geração, navegador, dimensões da viewport, SHA-256 do cartucho, resultado da medição, resumo e pontos amostrados. Cada ponto inclui tempo da página, contadores da máquina e do Canvas, geração, estado de reprodução e diagnósticos de áudio quando disponíveis.

O arquivo não contém bytes da ROM, registradores, memória, framebuffer, saída serial, estados salvos ou progresso de bateria. O SHA-256 identifica o cartucho e não substitui seus bytes. A exportação baixa um arquivo local; compartilhá-lo continua sendo uma escolha do proprietário.

## Validação no aparelho

Um perfil Pixel 7 no computador não homologa o Motorola Edge 40 Neo. Para avaliar esse aparelho, registre navegador, sistema, saída de áudio e economia de energia, compare os três cartuchos com e sem som e observe também cortes audíveis. Guarde janelas reais de 60 segundos depois do aquecimento e repita uma sessão sustentada. As métricas ajudam a localizar o gargalo, mas o aceite mobile depende do teste no dispositivo físico.

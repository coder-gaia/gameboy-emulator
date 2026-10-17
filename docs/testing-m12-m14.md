# Testar M12, M13 e M14

**Roteiro iniciado em 17 de outubro de 2026.** A candidata M14 é identificada como **1.0.0-rc.1** em **Sobre o projeto**. O aceite do Motorola depende dos testes abaixo.

| Marco | Situação deste roteiro                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M12   | Publicada, CI aprovado e 14 testes públicos aprovados. No Motorola, a música ficou contínua e não há travadas, mas ainda há lentidão percebida com áudio.    |
| M13   | Painel técnico e métricas concluídos: 1.395 testes locais, 103 externos, 176 de interface e 16 de produção aprovados.                                        |
| M14   | Candidata 1.0.0-rc.1 concluída: 1.473 testes locais, 103 externos, 176 de interface, 16 de produção e seis de áudio/vídeo aprovados. Aceite manual pendente. |

O desktop foi aprovado no grupo anterior. O problema relatado no Motorola Edge 40 Neo com Chrome aparece somente depois de ativar o som, nos três cartuchos. O [diagnóstico MB01](mobile-audio-investigation.md) preserva as evidências históricas, a implementação preparada e os critérios de aceite.

## Abrir a versão correta

A beta permanece em [gameboy-emulator-aox.pages.dev](https://gameboy-emulator-aox.pages.dev/). A conexão entre GitHub e Cloudflare Pages já existe. Depois do commit validado e do push de cada milestone em `main`, a Cloudflare cria o deploy automaticamente; não é necessário enviar `dist` manualmente nem criar outro projeto.

Para acompanhar, entre no painel da Cloudflare, abra **Workers & Pages**, selecione o projeto desse endereço e consulte **Deployments**. Aguarde o deploy de produção terminar com sucesso e confira o commit em `main`. Confira também o GitHub Actions: o build da Cloudflare não espera automaticamente pelos checks do GitHub. O [guia de deploy](deployment.md) registra a configuração e as verificações.

Depois da confirmação, abra a URL estável e recarregue normalmente a página no Chrome. Se a aba já estava aberta durante a publicação, recarregue antes do teste. HTML é revalidado e os assets têm nomes com hash; não é necessário limpar dados do site. Limpar esses dados também remove saves e preferências. Use a mesma origem para conferir persistência: previews, localhost e o endereço público possuem armazenamentos separados.

A publicação M12 foi confirmada com HTML e quatro assets idênticos aos hashes medidos, CI aprovado e 14 testes públicos de produção aprovados. A cada nova milestone, aguarde a confirmação do deploy correspondente antes de testar os recursos novos.

## Preparar o teste no Motorola real

Na M12 passaram 777 testes locais, 103 ROMs externas e os 156 cenários de interface do conjunto ampliado. Os 32 cenários pertinentes de áudio, estados e rewind passaram novamente após o ajuste final de consumo em voo. A regressão isolada de áudio aprovou os seis cenários em desktop e perfil simulado, com velocidade entre 99,30% e 100,24% e zero frames PCM ausentes ou descartados nas janelas estáveis de 12 segundos. O [relatório técnico](performance-audio-mobile-results.json) preserva hashes e limitações. Esses números não preenchem a tabela de resultados reais abaixo.

1. Use o Motorola Edge 40 Neo e o Chrome. Anote as versões do Android e do Chrome, data e horário, saída de áudio utilizada, estado da economia de bateria e se o aparelho está carregando. Mantenha essas condições durante a comparação.
2. Abra a beta HTTPS em uma aba normal, com a tela ligada e a página em primeiro plano. Fechar a tela, trocar de aplicativo ou ocultar a aba pode pausar o jogo; isso fica fora da janela de desempenho.
3. Deixe rewind desligado na primeira comparação. Ajuste o volume para um nível confortável. Para o teste realmente sem caminho de áudio, comece por uma página recarregada e ainda não toque em **Ativar som**.
4. Use um cronômetro em outro aparelho ou computador. Abrir o aplicativo de cronômetro no próprio telefone oculta o jogo e interfere no ensaio.
5. Não é necessário limpar saves. Exporte os estados que desejar preservar antes de fazer experiências com slots ou trocar de origem.

O perfil Pixel 7 do Playwright roda no computador e cobre viewport, toque e fluxos. Não testa o processador nem o sistema de áudio do Motorola. O experimento anterior de CPU throttle desacelerou a página, mas não o Worker. Atraso sintético de mensagens ajuda na regressão do protocolo; também não equivale ao aparelho real.

## Comparar antes e depois de ativar áudio

Faça a sequência abaixo separadamente para **jardim**, **Tobu Tobu Girl** e **2048**. Recarregue a página no início de cada jogo para garantir que a primeira janela ainda não tenha uma saída de áudio conectada. **Silenciar** altera o ganho; depois de ativado, o caminho de áudio permanece ativo mesmo sem som audível ou ao trocar de jogo.

1. Abra o cartucho sem ativar o som. Aguarde dez segundos de aquecimento, mova ou jogue durante uma janela de 60 segundos e observe velocidade, resposta e eventuais pausas. Registre a condição como **Antes de ativar áudio**.
2. Toque em **Ativar som**. Aguarde novamente dez segundos para priming e adaptação. Jogue por outra janela de 60 segundos nas mesmas condições. Registre como **Depois de ativar áudio**, sem silenciar durante essa janela.
3. No jardim, segure direita e depois cima, solte e toque em A para mudar a aparência. O personagem deve responder com velocidade comparável nas duas condições. O jardim gera PCM silencioso e não tem trilha; use-o para comparar cadência, não para julgar música.
4. Em Tobu Tobu Girl, confira a abertura, incluindo o trecho `sound by potato-tan`. Start pode pular a animação; no título, pressione Start novamente e confirme a fase com A. Jogue usando direcionais com A/B. O fluxo não deve ficar preso nos créditos nem passar a avançar lentamente depois de ativar o áudio. A trilha deve continuar sem cortes audíveis na janela estável.
5. Em 2048, comece com Start ou A e combine peças nas quatro direções. A animação deve manter velocidade comparável depois da ativação do áudio. A avaliação não depende de existir uma trilha contínua nesse cartucho.
6. Depois das comparações curtas, faça uma sessão de cinco minutos com áudio ativo em cada jogo. Observe se a execução permanece fluida depois do aquecimento do aparelho. Registre o instante de qualquer corte, pausa ou redução de velocidade; uma média boa não elimina um problema intermitente.

O comportamento sem áudio observado em 16 de outubro é a referência histórica. Este roteiro mede a build nova antes e depois da ativação; não exige reinstalar uma versão antiga ou substituir a publicação atual.

Para uma conferência numérica, use **Desempenho e áudio** e **Medir por 60 segundos**. O painel não exige abrir a inspeção de CPU. O cálculo também pode ser conferido manualmente a partir de T-cycles e tempo real:

```text
velocidade (%) = (T-cycles finais - T-cycles iniciais) / 4.194.304 / segundos reais * 100
```

Leituras manuais têm atraso. O painel M13 coleta amostras aproximadamente a cada segundo e exporta um JSON com taxa e latências de áudio disponíveis, fila, alvo, RTT atual e máximo, frames ausentes e descartados, velocidade e imagens desenhadas. O arquivo não contém ROM ou memória do jogo. Consulte [interpretação das métricas](performance-metrics.md). Quadros desenhados não comprovam a frequência física do monitor.

Critério proposto para a janela estável: velocidade entre 98% e 102%, sem cortes audíveis, sem crescimento de frames PCM ausentes ou descartados e sem queda sustentada depois de ativar o áudio. Esses valores são metas de aceite, não resultados já obtidos no Motorola. O priming inicial deve ser registrado separadamente do período estável.

| Jogo           | Sem áudio, 60 s | Com áudio, 60 s | Com áudio, 5 min | Resultado no Motorola |
| -------------- | --------------- | --------------- | ---------------- | --------------------- |
| Jardim         | Pendente        | Pendente        | Pendente         | Pendente              |
| Tobu Tobu Girl | Pendente        | Pendente        | Pendente         | Pendente              |
| 2048           | Pendente        | Pendente        | Pendente         | Pendente              |

## Pausa, mute, slots e rewind com áudio

Faça estes testes fora das janelas cronometradas, primeiro no Motorola e depois no desktop:

1. Em Tobu Tobu Girl, ative o som, pause pelo botão externo **Pausar**, aguarde alguns segundos e escolha **Iniciar**. A máquina para durante a pausa e volta a tocar do ponto atual, sem despejar música antiga acumulada.
2. Escolha **Silenciar**, continue jogando e depois **Ativar som**. Silenciar deve remover o áudio audível e preservar a velocidade; reativar deve recuperar a trilha atual. Ajuste o volume e confira que os controles continuam respondendo.
3. No jardim, com áudio ativo, mova o personagem, salve um slot, avance e carregue o mesmo slot. O ponto salvo deve voltar em pausa. Escolha **Iniciar** para retomar a cadência normal. Exporte um estado, avance e importe o arquivo para repetir a verificação. Nos jogos com trilha, também confira a retomada sem fila antiga.
4. Ative rewind, jogue alguns segundos e segure **Segure para voltar**. Durante o gesto, o áudio fica suspenso. Solte em um ponto reconhecível: uma partida antes em execução deve retomar dali, incluindo o áudio. Repita com a partida pausada; ela deve permanecer pausada ao soltar.
5. Repita um gesto de rewind e oculte a aba. Ao voltar, o jogo deve estar pausado e os controles livres. A retomada exige uma ação explícita.
6. Troque entre Tobu, 2048 e jardim depois de ativar áudio. A nova máquina não deve tocar PCM do cartucho anterior. Depois recarregue a página para conferir slots e o progresso salvo pelo próprio jogo, quando houver bateria. A persistência depende do mesmo endereço e perfil de navegador.

O rewind também retorna RAM e progresso gravado pelo próprio jogo. Seus pontos intermediários não devem substituir o save final escolhido. Confira os detalhes e limites em [rewind](rewind.md) e [estados salvos](save-states.md).

## Setas maiores e múltiplos dedos

1. No Motorola em retrato, abra o jardim e confira as quatro setas. Os alvos devem estar maiores onde houver espaço, com ícones mais legíveis. Os alvos chegam a 52 por 52 CSS px; em uma largura estreita de 320 px, preservam 44 por 44 px para caber sem sobreposição. Ícones de toque usam 22 px.
2. Segure direita com um dedo e A com outro. Solte apenas A: o direcional deve continuar pressionado. Depois solte direita, inclusive arrastando o dedo para fora antes de soltar. Nenhuma entrada deve ficar presa.
3. Segure duas direções não opostas, solte uma e depois a outra. A representação de cada botão deve acompanhar o dedo correspondente; a resposta a combinações depende do jogo.
4. Gire para paisagem e use **Tela cheia**. Confira tela, direcionais, A/B, Start/Select, reprodução, volume e rewind sem sobreposição. Repita o gesto com dois dedos. Se a plataforma recusar tela cheia, a mensagem deve explicar a limitação e a página deve continuar utilizável.
5. Saia da tela cheia, role até os painéis e volte ao console. Confira que os controles continuam ativos somente quando a partida está em execução. Pausar ou ocultar a aba deve soltar todas as entradas.
6. Como verificação complementar de layout no computador, confira 320 px em retrato e 640 por 360, 740 por 360 e 844 por 390 em tela cheia. A emulação de toque serve para medir alvos e recortes; não homologa desempenho mobile. No desktop com ponteiro fino, os tamanhos anteriores permanecem.

## Cartuchos adicionais da M12

Os novos controladores não acrescentam automaticamente jogos à biblioteca. Tobu Tobu Girl e 2048 permanecem os jogos embutidos, além do jardim próprio. A ampliação do catálogo exige seleção e permissão clara de distribuição.

Depois do fechamento da M12, quem já possui um cartucho próprio autorizado MBC2, MBC3 ou MBC5 pode usar **Carregar cartucho** e seguir a ajuda **Quais arquivos posso usar?**. O arquivo permanece local. Confira início, troca de cenários, progresso salvo pelo próprio jogo e restauração de slots. RTC só se aplica a variantes MBC3 que realmente possuem relógio; rumble não produz vibração. Os limites e resultados técnicos serão registrados com a entrega, sem exigir que o proprietário obtenha uma ROM adicional para testar áudio e toque.

## Painel técnico da M13

1. Abra o jardim e pause. Em **Inspecionar CPU**, abra **Painel técnico**. Devem aparecer a página de memória, 12 instruções a partir do PC, os 384 tiles, os 40 sprites, os registradores de vídeo, timer, DMA e interrupções, além dos dados do cartucho.
2. Compare os T-cycles antes e depois de aguardar alguns segundos com a máquina pausada. Consultar dados não pode avançar a máquina. Use **Uma instrução** para observar PC, bytes e desassemblador acompanhando o mesmo ponto.
3. Em **Endereço hexadecimal**, consulte `8000`, `C000` e `FF00`. A última página inclui IE em `FFFF`. **Página anterior** e **Próxima página** respeitam os limites. `C001`, `XYZ` ou um valor fora da faixa devem gerar uma mensagem útil e preservar a página válida.
4. Confira que tiles e prévia de OAM usam tons neutros. A prévia mostra padrões, espelhamento e altura dos objetos; não recompõe posições, prioridades ou paletas da tela. O dump é uma leitura dos dados internos, mesmo quando a CPU teria o acesso bloqueado.
5. Navegue com Tab e Shift+Tab. As tabelas largas possuem rolagem própria e foco visível; em 320 px a página inteira não deve ganhar rolagem horizontal. Fechar **Painel técnico** ou **Inspecionar CPU** interrompe as consultas. Ocultar a aba também suspende a inspeção.

## Medição da M13 e lentidão restante

1. Recarregue a beta no Motorola e abra Tobu sem ativar o som. Abra **Desempenho e áudio**, aguarde a primeira amostra e escolha **Medir por 60 segundos**. Volte ao console para jogar, mantendo o painel aberto e a página visível, sem pausar nem ocultar a aba. Deixe a inspeção técnica fechada. Ao final, anote velocidade média e quadros desenhados/s; exporte o diagnóstico se desejar guardá-lo.
2. Ative o som, aguarde dez segundos de aquecimento e repita a janela. Compare velocidade, quadros desenhados, frames ausentes e descartados. Música contínua com velocidade próxima de 100% e menos imagens desenhadas sugere um problema de apresentação; velocidade menor pede investigação da cadência de execução. Esses sinais orientam a análise e não substituem a percepção no aparelho.
3. Inicie outra medição e pause. O relatório deve informar interrupção e permitir exportar a janela parcial. Retome e comece uma nova janela, sem misturar gerações. Fechar somente **Inspecionar CPU** não encerra o painel independente de métricas; fechar **Desempenho e áudio** encerra a coleta.
4. Confira que carregar um estado no mesmo cartucho preserva um relatório já concluído. Uma medição ativa é interrompida por mudança de sessão, rewind ou página oculta. Trocar ou reiniciar o cartucho inicia outra instância e não mantém um relatório da máquina anterior.

## M14 e fechamento do grupo

1. Abra **Sobre o projeto** e confirme **1.0.0-rc.1** depois do deploy. Isso evita testar uma aba que ainda contém a versão anterior.
2. No Motorola, compare movimento do jardim, deslocamento dos tiles do 2048 e partida de Tobu antes e depois de ativar som. A música deve permanecer contínua e o desenho deve acompanhar o movimento. A reserva de áudio ainda pode introduzir latência entre o toque e a resposta; descreva essa diferença separadamente de movimento em saltos ou de velocidade emulada menor.
3. Confira os direcionais maiores em retrato e paisagem, incluindo dois dedos. No desktop, repita um jogo com som, pausa e retomada para preservar o comportamento aprovado.
4. Pause, salve um slot, avance e carregue. Depois teste rewind com som. O ponto escolhido deve voltar sem imagens ou áudio da sessão anterior. A pausa mostra o estado atual da máquina, que pode estar adiantado em relação à apresentação pela reserva PCM.
5. Explore o painel técnico e exporte uma medição. Confira o fundo creme, a aparência sólida do console e o foco por teclado. As capturas em [mídia](media/README.md) servem de referência visual.
6. Revise os textos de [portfólio](portfolio.md), [LinkedIn](linkedin.md) e [release](release-notes.md). São rascunhos prontos para revisão; o proprietário decide a publicação depois do aceite.

Ao finalizar o grupo, fazemos a pausa para o proprietário testar e dar o ok. O teste no Motorola continua necessário antes de afirmar desempenho mobile homologado ou apresentar essa correção como validada no aparelho. Não é preciso obter uma ROM adicional: os três cartuchos disponíveis cobrem o roteiro principal.

Para relatar uma falha, envie jogo, versão do Chrome/Android, condição de som e rewind, saída utilizada, orientação, tempo aproximado até o problema e se ocorre antes ou depois de ativar áudio. Informe também se uma página recarregada volta a executar normalmente sem áudio. Uma gravação curta pode ajudar, mas a gravação no próprio celular acrescenta carga e deve ser identificada no relato.

Fechamento automatizado M14: todos os checks passaram na fonte e no artefato final. A coleta em computador mediu 100,03% a 100,27% de velocidade emulada e 58,30 a 58,89 desenhos/s, sem PCM ausente ou descartado. Consulte o [relatório com hashes](performance-video-results.json). Confirme o deploy em main e a versão em Sobre antes de iniciar o teste físico; esses resultados não são números medidos no Motorola.

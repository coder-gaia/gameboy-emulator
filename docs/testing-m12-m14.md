# Testar M12, M13 e M14

**Roteiro em andamento, iniciado em 17 de outubro de 2026.** A M12 implementa o abastecimento adaptativo de áudio, setas maiores e os controladores MBC2, MBC3 com RTC e MBC5. M13 e M14 aguardam implementação. Este documento não declara as três milestones concluídas nem o Motorola homologado.

| Marco | Situação deste roteiro                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| M12   | Implementada e verificada no computador. Aguardar confirmação do deploy e testar áudio e toque no Motorola real.                            |
| M13   | Painel técnico aguardando implementação. O roteiro específico será acrescentado após a entrega.                                             |
| M14   | Release, README, portfólio e material para LinkedIn aguardando implementação. O roteiro final depende das entregas e do aceite mobile real. |

O desktop foi aprovado no grupo anterior. O problema relatado no Motorola Edge 40 Neo com Chrome aparece somente depois de ativar o som, nos três cartuchos. O [diagnóstico MB01](mobile-audio-investigation.md) preserva as evidências históricas, a implementação preparada e os critérios de aceite.

## Abrir a versão correta

A beta permanece em [gameboy-emulator-aox.pages.dev](https://gameboy-emulator-aox.pages.dev/). A conexão entre GitHub e Cloudflare Pages já existe. Depois do commit validado e do push de cada milestone em `main`, a Cloudflare cria o deploy automaticamente; não é necessário enviar `dist` manualmente nem criar outro projeto.

Para acompanhar, entre no painel da Cloudflare, abra **Workers & Pages**, selecione o projeto desse endereço e consulte **Deployments**. Aguarde o deploy de produção terminar com sucesso e confira o commit em `main`. Confira também o GitHub Actions: o build da Cloudflare não espera automaticamente pelos checks do GitHub. O [guia de deploy](deployment.md) registra a configuração e as verificações.

Depois da confirmação, abra a URL estável e recarregue normalmente a página no Chrome. Se a aba já estava aberta durante a publicação, recarregue antes do teste. HTML é revalidado e os assets têm nomes com hash; não é necessário limpar dados do site. Limpar esses dados também remove saves e preferências. Use a mesma origem para conferir persistência: previews, localhost e o endereço público possuem armazenamentos separados.

Enquanto o deploy da M12 não estiver confirmado, o site pode continuar entregando a M11. Nesse caso, a lentidão conhecida ainda pode ser reproduzida e não representa avaliação da correção nova.

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

Para uma conferência numérica provisória, abra **Inspecionar CPU** e anote **T-cycles executados** no começo e no fim de cada janela, sem pausar. Com o tempo real transcorrido, calcule:

```text
velocidade (%) = (T-cycles finais - T-cycles iniciais) / 4.194.304 / segundos reais * 100
```

Leituras manuais têm atraso e não substituem a coleta técnica. M13 ainda não entregou o painel completo. Na validação técnica, também devem ser coletados `sampleRate`, `baseLatency` e `outputLatency` disponíveis, alvo e ocupação da fila, `roundTripFrames`, frames ausentes e descartados, além de amostras por segundo. Não é necessário procurar esses campos no painel atual da interface.

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

## M13, M14 e fechamento do grupo

M13 aguarda a implementação do painel técnico. M14 aguarda a implementação e revisão da release, documentação final e materiais de portfólio. Seus passos de teste devem ser incluídos aqui quando esses fluxos existirem.

Ao finalizar o grupo, o roteiro deve registrar os checks executados, a versão realmente publicada, os resultados dos três marcos e as pendências. O teste no Motorola continua necessário antes de afirmar desempenho mobile homologado ou apresentar essa correção como validada no aparelho.

Para relatar uma falha, envie jogo, versão do Chrome/Android, condição de som e rewind, saída utilizada, orientação, tempo aproximado até o problema e se ocorre antes ou depois de ativar áudio. Informe também se uma página recarregada volta a executar normalmente sem áudio. Uma gravação curta pode ajudar, mas a gravação no próprio celular acrescenta carga e deve ser identificada no relato.

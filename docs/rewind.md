# Rewind da M11

O rewind permite escolher um ponto recente da partida sem criar um slot. Ele começa desligado. O histórico fica na memória desta aba e depende da ativação explícita do usuário.

**Estado da entrega:** M11 concluída. Passaram 26 testes específicos nos perfis desktop e Pixel 7 simulado: 18 de rewind, quatro de recuperação e quatro de tela cheia. A regressão cobre 130 cenários de navegador; o build final passou pelos 14 testes de produção. O fundo pastel/off-white também passou pela revisão visual e de acessibilidade. Consulte os resultados e o [roteiro de revisão do grupo](testing-m09-m11.md).

## Usar o recurso

1. Abra um cartucho e escolha **Ativar rewind** no painel **Um instante atrás.**.
2. Jogue por alguns segundos. **Tempo disponível para rewind** mostra o trecho guardado. O tempo só cresce quando a máquina avança.
3. Com a tela em foco, segure **R**, ou mantenha o botão **Segure para voltar** pressionado por ponteiro ou toque. Pelo teclado, Tab alcança esse botão e Enter ou Espaço mantêm o gesto.
4. Solte para escolher o ponto exibido. A reprodução retoma se estava em execução antes do gesto e se a página ainda puder continuar. Uma partida que já estava pausada permanece pausada.
5. **Desativar rewind** descarta o histórico e libera a referência à arena de buffers.

Um clique curto permite voltar um ponto. A ativação por tecnologia assistiva, sem gesto mantido, também realiza um passo. Quando o trecho chega ao começo, a imagem para nesse ponto; o gesto continua válido até ser solto ou cancelado.

R permanece disponível para uma ação do jogo quando estiver remapeado em **Controles e preferências**. Nesse caso, use o botão de voltar. O atalho de rewind não captura campos de texto, links, botões, painéis ou diálogos, nem combinações com modificadores do navegador.

Perder o foco da janela, ocultar a aba, cancelar o ponteiro ou pressionar Escape encerra em pausa. A página não retoma sozinha depois dessas interrupções. Soltar um gesto que foi cancelado não deve iniciar a partida.

## O que é recuperado

Cada ponto representa a máquina e o texto serial da sessão. São recuperados CPU, memória, mapper e RAM do cartucho, PPU e framebuffer, timer, DMA, serial, joypad e APU. A ROM permanece carregada e não é duplicada no histórico.

O Worker restaura o estado pelo mesmo caminho validado usado nos save states. Entradas mantidas são liberadas para evitar uma tecla ou direção presa depois do retorno. O inspetor permanece consultável; avançar instruções, salvar ou carregar estados e trocar o cartucho ficam bloqueados durante o gesto.

A apresentação de áudio é limpa ao começar e terminar o rewind. O AudioContext fica suspenso enquanto o usuário volta, e uma nova geração de áudio invalida PCM antigo. A APU é restaurada junto da máquina. Ao retomar, o som parte do ponto escolhido, sem reproduzir a fila da linha do tempo descartada.

Se suspender o AudioContext falhar depois de `rewind-start`, o encerramento ainda envia `rewind-end` ao Worker e mantém a máquina em pausa. A interface apresenta o erro e permite uma nova tentativa de continuar. O Worker permanece disponível para a sessão.

Carregar ou importar um estado, recuperar a bateria durante a abertura, reiniciar ou trocar a ROM limpa o trecho anterior. Quando uma alteração da taxa de áudio exige outro histórico, ele também é reiniciado. Um ponto inicial pode permanecer como âncora interna; ele não oferece duração para voltar. Depois de retomar, novos pontos são capturados a partir da continuação escolhida. Não existe redo da linha do tempo descartada.

## Tempo e memória

O Worker visa capturas periódicas de **aproximadamente 10 Hz do tempo emulado**. A verificação ocorre nos limites dos seus orçamentos de execução, e cada ponto usa o timestamp real em T-cycles. A diferença entre dois pontos pode variar conforme o trabalho executado nesse orçamento. Há capturas adicionais na ativação e no início do gesto para incluir o ponto atual. O limite é **até 20 segundos** e **201 pontos**, sujeito ao orçamento de memória. Jogos com mudanças maiores podem preservar um trecho menor.

O histórico usa uma arena de **8 MiB** por máquina habilitada. Essa arena contém três áreas de trabalho de 128 KiB e um pool circular para transições. Cada checkpoint é serializado em um formato binário interno de até 128 KiB; deltas XOR usam trechos esparsos ou representação densa conforme o menor tamanho. Estados antigos são retirados quando ultrapassam tempo, quantidade ou espaço disponível.

Os 8 MiB limitam os buffers do histórico e de trabalho. A ROM, a máquina atual, objetos de controle JavaScript, o checkpoint temporário decodificado, o Canvas e as filas de áudio ficam fora desse orçamento. Ele não representa o consumo total da aba. `allocatedBytes` e `usedBytes` nos snapshots descrevem a arena; `availableSeconds` usa a diferença de T-cycles entre o ponto mais antigo e o cursor atual.

O codec interno não substitui o arquivo `.pocketstate`. Não há exportação nem persistência do histórico de rewind. Fechar ou recarregar a página descarta esse trecho. Para manter um ponto entre sessões ou em outro navegador, use um slot ou um arquivo exportado.

## Bateria e falhas de armazenamento

Voltar também desfaz a RAM do jogo. O ponto escolhido passa a ser a continuação atual, incluindo recordes ou progresso que o próprio cartucho guardou nessa RAM. O rewind não deve ser usado como backup de bateria.

Enquanto o gesto está ativo, os snapshots de apresentação não expõem baterias intermediárias e os checkpoints de armazenamento ficam suspensos. Ao terminar, o Worker publica a RAM final e o fluxo de bateria solicita sua gravação. Os controles continuam bloqueados até essa gravação final concluir, inclusive quando o Worker já deixou de voltar. Assim, o autosave não percorre e persiste cada ponto visitado durante o retorno, e outra operação não disputa uma gravação ainda pendente. Cancelar durante essa espera impede uma retomada posterior automática.

Se a gravação final falhar, a interface informa que o ponto foi recuperado, mas o progresso não pôde ser gravado. A troca de cartucho continua passando pelas guardas de bateria: uma falha mantém o cartucho atual, até tentar novamente ou escolher explicitamente **Continuar sem salvar**. O histórico em memória não consome cota do IndexedDB, mas salvar a bateria final ainda depende desse armazenamento.

## Verificação

O [roteiro M09 a M11](testing-m09-m11.md) descreve os testes manuais. A cobertura automatizada inclui codec e deltas, orçamento de memória, restauração completa, atalho reservado, fontes de entrada, pausa e retomada, cancelamentos, som, troca de ROM e guardas de bateria.

Para executar os casos específicos em desenvolvimento:

```powershell
npm.cmd run test:e2e -- tests/e2e/rewind.spec.ts --workers=2
```

Depois de gerar a build final, os casos de produção usam o servidor estático e a CSP:

```powershell
npm.cmd run build
npm.cmd run test:production -- tests/production/rewind.spec.ts --workers=2
```

O [benchmark reproduzível](performance.md#rewind-na-m11) também mede captura, memória e 100 restaurações por cenário, preservando os hashes de estado e PCM. A validação em aparelho móvel, gamepad físico e leitor de tela real continua dependendo dos testes manuais do proprietário.

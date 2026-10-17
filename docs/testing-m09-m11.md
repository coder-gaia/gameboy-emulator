# Testar M09, M10 e M11

Este grupo entrega controles e preferências, a beta estática publicada, rewind e o fundo creme. **M09, M10 e M11 estão concluídas.** O desenvolvimento está pausado antes da M12 para a revisão do proprietário. Siga este roteiro no desktop e, se possível, no celular.

**Retorno da revisão:** o proprietário aprovou desktop. No Motorola Edge 40 Neo com Chrome, os jogos ficam fluidos sem som, mas ativar áudio causa lentidão e cortes. O [diagnóstico MB01](mobile-audio-investigation.md) registra as evidências e o plano. A correção e setas de toque maiores entram na próxima sessão, no lote M12 a M14. O aceite mobile permanece pendente; o perfil Pixel 7 simulado não substitui esse teste.

## Escolher o endereço

Abra a [beta pública](https://gameboy-emulator-aox.pages.dev/). Ela recebe novas entregas depois do push e do deploy correspondente. Para conferir qual build foi publicado, veja o [guia de deploy](deployment.md). Também é possível testar o mesmo código localmente.

Na raiz, com Node.js 22.12 ou superior:

```powershell
npm.cmd ci
npm.cmd run dev
```

Abra o endereço exibido no terminal. Se as dependências já estiverem instaladas e o lockfile não tiver mudado, basta `npm.cmd run dev`. Use o mesmo endereço e perfil de navegador ao conferir persistência. Localhost, `127.0.0.1`, previews e o site público têm armazenamentos separados.

## Teclado, foco e preferências

1. Recarregue a página e pressione Tab. **Ir para o console** deve aparecer com foco visível. Ative o link; a navegação deve alcançar o console.
2. Escolha **Explorar jardim**. Setas movem o personagem, Z/A muda a aparência e X/B volta à posição inicial. Os botões do console funcionam por toque ou ponteiro.
3. Abra **Controles e preferências**. O jogo pausa. Selecione o campo **Tecla para Botão A** e pressione C. O campo deve mostrar C. Use **Iniciar**, clique na tela e teste C; Z não deve mais executar essa ação.
4. Abra o painel novamente e tente atribuir X ao botão A. A mensagem deve explicar que a tecla já está em uso, preservando C. Tab deve navegar entre campos; Escape sai do campo.
5. Selecione a paleta **Light** e ajuste o volume, por exemplo, para 25%. Recarregue, abra o jardim e confira paleta, volume e o campo C. Os ajustes devem permanecer. O som continua exigindo uma nova ação explícita para ser ativado.
6. Escolha **Restaurar teclado padrão**. A volta para Z deve ser confirmada. Retome e confira que o mapa padrão funciona.
7. Navegue por Tab até **Sobre**, abra a apresentação e use Escape. O diálogo fecha e devolve o foco ao botão. Repita com **Quais arquivos posso usar?**. Os controles da página ao fundo não devem ser ativáveis enquanto um diálogo estiver aberto.

O [documento de controles](controls-and-preferences.md) registra compatibilidade e detalhes de remapeamento. A automação inclui contraste, foco e larguras de 320, 390 e 1440 pixels; o teste com leitor de tela real permanece manual.

## Tela cheia e controle físico opcional

1. Com o jardim em execução, escolha **Tela cheia**. O console ocupa a área disponível e continua respondendo. Use **Sair da tela cheia** para voltar à página. Se a plataforma recusar a API, uma mensagem deve explicar a limitação e o jogo deve continuar utilizável.
2. Em celular, confira retrato e paisagem, sem sobreposição de botões. Role até os painéis e volte ao console. Soltar um dedo libera a entrada, inclusive depois de pressionar direcional e A ao mesmo tempo.
3. Opcionalmente, conecte um controle USB ou Bluetooth reconhecido como padrão e pressione um botão. Abra **Controles e preferências** e confira o reconhecimento.
4. Use direcional ou analógico esquerdo para mover. Os dois botões inferiores enviam A/B e os centrais Select/Start. Misture teclado e controle; soltar uma fonte não deve cancelar outra ainda mantida. Desconectar libera as entradas desse controle.

Os testes automatizados de gamepad usam entradas simuladas. Não representam teste de dispositivo físico. O site público HTTPS é a opção adequada para conferir áudio em um celular; acesso por HTTP a um IP da rede local pode executar sem AudioWorklet.

## Beta pública, áudio e saves

1. Abra o [endereço público](https://gameboy-emulator-aox.pages.dev/) e escolha Tobu Tobu Girl. Enter/Start avança a abertura e o título; Z/A confirma a fase. Clique na tela se o teclado ainda estiver focado em um botão ou painel.
2. Ative o som, ajuste o volume, silencie, pause e retome. Não deve tocar uma fila antiga depois da pausa. O jardim não tem trilha e não serve para conferir áudio.
3. Abra 2048 e comece com Enter/Start ou Z/A. Use as setas para combinar peças. **Controles e créditos dos jogos** apresenta instruções e licenças das duas demos.
4. Abra o jardim, mova o personagem e salve um slot. Avance, mude de posição e carregue. A máquina deve voltar ao ponto salvo, em pausa.
5. Exporte um estado, avance e importe o arquivo. O ponto exportado deve voltar. Recarregue, abra o mesmo cartucho e confira o slot. Seus saves locais de desenvolvimento não devem aparecer automaticamente no site público.

A M10 pública passou pelos dez testes de produção, com Worker, PCM real no Worklet, demos verificadas por SHA-256, armazenamento, arquivos, teclado e fullscreen. Não houve erros, violações CSP ou requisições da aplicação a terceiros. Consulte [publicação e validação](deployment.md). Os resultados de desempenho históricos foram medidos em loopback, com perfis documentados em [desempenho](performance.md), e não são uma medição de rede de cada visitante.

## Voltar no jardim

1. Abra o jardim e escolha **Ativar rewind**. O botão passa a **Desativar rewind**. Jogue um pouco: o indicador de tempo disponível deve aumentar.
2. Mova o personagem por aproximadamente três segundos, usando direita e depois cima. Solte as setas e clique na tela.
3. Segure R. A imagem deve percorrer pontos anteriores. Enquanto volta, salvar estados, reiniciar e trocar de cartucho ficam bloqueados; o botão **Segure para voltar** continua disponível para o gesto.
4. Solte R em um ponto reconhecível. Se o jogo estava rodando, ele retoma desse ponto. Mova novamente para confirmar que a continuação usa a posição recuperada.
5. Clique em **Pausar**, depois clique na tela e segure R. Solte. A imagem volta, mas permanece pausada até usar **Iniciar**.
6. Retome e teste o botão **Segure para voltar** por ponteiro ou toque. Pelo teclado, alcance esse botão com Tab e segure Espaço ou Enter. Um clique curto deve voltar um ponto.
7. Comece outro gesto e troque de aba ou tire o foco da janela. Ao voltar, a partida deve estar pausada. Soltar o gesto cancelado não deve retomar automaticamente.
8. Segure até alcançar o começo do trecho. O indicador chega a zero e a imagem para nesse ponto. Soltar encerra normalmente; não deve deixar controles presos ou a página bloqueada.

O histórico guarda até 20 segundos, com buffers limitados a 8 MiB; isso não é um limite para toda a memória da aba. O trecho disponível pode ser menor dependendo das mudanças do jogo. Confira os [limites e o funcionamento do rewind](rewind.md).

## Remapeamento, áudio e limpeza do histórico

1. Ative rewind, abra **Controles e preferências** e remapeie A para R. Retome e pressione R com a tela em foco. O jardim deve mudar a aparência, sem iniciar rewind. A interface informa que R está em uso; o botão de voltar continua utilizável. Restaure o teclado padrão ao terminar.
2. Abra Tobu Tobu Girl, ative rewind e som e jogue um pouco. Segure para voltar. O áudio fica suspenso durante o gesto. Solte: a reprodução e o som retomam do ponto escolhido se a partida estava rodando, sem tocar trechos da fila antiga.
3. No jardim, guarde um slot, retome e acumule histórico. Carregue o slot. A imagem retorna em pausa e o trecho anterior é descartado. Jogue de novo para criar histórico a partir desse ponto.
4. Troque de cartucho e confira que o novo jogo não reutiliza o trecho anterior. Recarregar a página também descarta o rewind.
5. Escolha **Desativar rewind**. O indicador fica sem trecho disponível e voltar deixa de estar habilitado. Slots e arquivos exportados continuam independentes.

Voltar também restaura a RAM e o progresso gravado pelo próprio jogo. Ao encerrar, a bateria recebe o ponto final escolhido; os pontos intermediários não devem ser persistidos. Os controles continuam bloqueados até a gravação final concluir. Se houver demora, aguarde a liberação antes de salvar ou trocar de cartucho. A cobertura automatizada usa uma ROM MBC1 própria para verificar esse fluxo, bateria lenta e a preservação do cartucho quando a cota do armazenamento falha.

O histórico usa capturas de aproximadamente 10 Hz, alinhadas aos limites dos orçamentos de execução do Worker e identificadas por timestamps reais em T-cycles. O retorno percorre esses pontos; o intervalo entre capturas pode variar. Uma falha ao suspender o áudio depois de iniciar rewind também encerra o gesto no Worker, mantém a máquina em pausa e permite tentar continuar novamente.

## Fundo e conforto visual

O último ajuste visual foi concluído com o fundo **#eee9df**. Quinze análises axe terminaram sem violações. Sobre esse fundo, os contrastes medidos são 10,72:1 no texto principal, 4,87:1 no secundário e 6,57:1 no destaque. A inspeção em desktop, viewport móvel e tela cheia confirmou que console e ancestrais mantêm opacidade 1 e filtros `none`, preservando a aparência do Game Boy.

Confira também no seu desktop e celular:

1. O fundo deve usar um tom pastel/off-white confortável, com texto e foco legíveis.
2. O corpo do Game Boy deve preservar volume, contraste e contornos. Ele não deve parecer opaco, lavado ou coberto por uma camada do fundo.
3. Paletas DMG, Pocket e Light continuam distinguíveis. Os detalhes do jogo, slots, botões e diálogos devem permanecer legíveis.
4. Se o sistema estiver com movimento reduzido, transições decorativas não devem causar animação intensa.

## Checks e registro de problemas

Na raiz:

```powershell
npm.cmd run check
npm.cmd run test:hardware
npm.cmd run test:e2e
npm.cmd run test:production
```

Os testes de navegador precisam do Chromium: `npx.cmd playwright install chromium`. A preparação dos testes externos usa revisões e hashes fixados.

Validação local da entrega:

- `npm.cmd run check`: regras, formatação, lint, tipos, 677 testes e build aprovados.
- Hardware: 87 casos aprovados, incluindo CPU, timing, LCD, MBC1, dmg-acid2 e `dmg_sound`.
- Navegador: 130 cenários cobertos. A execução inicial teve 129 aprovações e revelou contraste de 4,46:1 na ajuda de cartuchos. A cor foi corrigida para 4,87:1; o caso falho passou na repetição e os 22 casos de acessibilidade passaram novamente.
- Produção local: 14 testes aprovados sob CSP, com Worker e áudio reais.
- Rewind: 26 casos específicos, 15 análises axe adicionais e benchmark com cinco pares de 25 segundos e 100 restaurações por cenário, todos aprovados dentro do escopo documentado.

O CI repete os checks em cada push. Os comandos para validar o endereço público estão em [publicação](deployment.md). Testes simulados não substituem um aparelho, controle físico ou leitor de tela real.

Registre problemas com endereço usado, cartucho, navegador ou aparelho, passos e resultado observado. O próximo grupo só começa depois do ok do proprietário.

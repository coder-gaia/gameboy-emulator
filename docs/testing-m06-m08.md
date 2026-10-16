# Testar M06, M07 e M08

Este grupo entrega MBC1, biblioteca de jogos autorizados, bateria, áudio e estados salvos. M06, M07 e M08 foram aprovadas pelo proprietário. O roteiro permanece como referência, usa somente o conteúdo incluído na aplicação e não exige serviço pago.

## Abrir o projeto

Na raiz do projeto, com Node.js 22.12 ou superior, execute no PowerShell:

```powershell
npm.cmd ci
npm.cmd run dev
```

Abra o endereço mostrado no terminal, normalmente `http://127.0.0.1:5173`. Se as dependências já estiverem instaladas e o lockfile não tiver mudado, basta `npm.cmd run dev`. Use o mesmo endereço e perfil de navegador durante os testes de persistência.

## Biblioteca e controles

1. Escolha **Tobu Tobu Girl** na biblioteca. O header informa MBC1, 256 KiB de ROM, 8 KiB de RAM e bateria. Os logos e a animação inicial pertencem ao jogo original.
2. Pressione **Enter**, equivalente a **Start**, para pular a abertura. No título, pressione Enter novamente e confirme a fase com **Z**, equivalente a **A**. Se necessário, clique na tela para tirar o foco de um controle da interface antes de usar o teclado.
3. Use as setas para escolher a direção e Z/A para dar um impulso. Segure **X/B** para voar enquanto houver energia. Enter/Start também pausa dentro do próprio jogo. Essa pausa do jogo é diferente do botão **Pausar** do emulador.
4. Escolha **2048**. O header informa MBC1, 32 KiB de ROM, 2 KiB de RAM e bateria. O aviso sobre RAM de 2 KiB explica uma convenção homebrew aceita. Pressione Enter/Start ou Z/A para começar e use as setas para combinar peças.
5. Abra **Controles e créditos dos jogos**. Os autores, licenças e ações de cada jogo devem estar disponíveis. Feche a ajuda e use **Iniciar** caso o emulador tenha sido pausado.

Os botões do console também funcionam por ponteiro ou toque. O [documento dos jogos](demo-games.md) registra os binários, controles e licenças. Não é necessário procurar ou enviar um cartucho para jogar essas demos.

## Bateria local

1. Jogue 2048 ou Tobu Tobu Girl por um tempo, permitindo que o próprio jogo atualize seus dados persistentes. No 2048, termine uma partida com pontuação para conferir os dados que o jogo decide preservar.
2. Clique em **Pausar** e aguarde a conclusão das operações indicadas pela interface. A pausa solicita um checkpoint de bateria quando existem mudanças.
3. Recarregue a página no mesmo endereço e abra o mesmo jogo. A interface informa quando recupera progresso de bateria. Confira os recordes, opções ou progresso que esse jogo grava.
4. Troque de jogo e volte. Os dados de bateria dos dois cartuchos devem permanecer separados. Reiniciar o emulador também preserva a bateria.

A bateria não é uma fotografia da partida. O resultado esperado depende do que o firmware do jogo grava, e não é necessariamente a mesma tela, posição ou tabuleiro. Para voltar exatamente ao ponto atual, siga o teste de estados abaixo. O jardim não tem bateria, mas pode usar estados salvos.

Os dados ficam neste navegador e nesta origem. Trocar de `127.0.0.1` para `localhost`, usar outro perfil ou limpar os dados do site pode apresentar outro armazenamento. Não limpe esses dados para testar a atualização: IndexedDB v2 deve preservar a bateria já existente.

## Som, volume e pausa

1. Abra Tobu Tobu Girl em localhost e clique em **Ativar som**. Caso a máquina esteja pausada, clique em **Iniciar**. A trilha e os efeitos devem ser ouvidos. O jardim não possui trilha e não serve para esse teste.
2. Mova **Volume** para um valor baixo e depois aumente. O nível deve acompanhar o controle sem alterar a velocidade do jogo.
3. Clique em **Silenciar**. O jogo continua, mas a saída fica muda. Use a ação de reativar o som para voltar a ouvir.
4. Clique em **Pausar**. A imagem e o áudio param. Espere alguns segundos e clique em **Iniciar**. A partida retoma sem reproduzir uma fila antiga de som.
5. Troque de aba e volte. A máquina permanece pausada até usar **Iniciar**. Reiniciar ou trocar o cartucho também não deve reproduzir trechos pendentes da sessão anterior.

Opcionalmente, escute uma partida por cinco minutos reais, usando volume confortável. Observe cortes, estalos, aceleração, atraso acumulado e o comportamento ao pausar e retomar. Esse é um teste manual a ser feito pelo proprietário; não é uma escuta já realizada nem uma promessa de qualidade acústica idêntica ao console físico.

Áudio exige HTTPS ou localhost e suporte a AudioWorklet. HTTP por IP da rede local pode executar o jogo sem disponibilizar áudio. Nesse caso, uma mensagem de indisponibilidade e a continuidade sem som são o comportamento esperado. Consulte [funcionamento e limites do áudio](audio-runtime.md).

## Salvar, carregar e manter os três slots

Use o jardim para comparar posições sem depender das regras de save de um jogo.

1. Clique em **Explorar jardim** e mova o personagem para perto de uma nuvem ou outro ponto fácil de reconhecer. Solte todas as teclas. No painel **Um ponto para voltar.**, selecione **Slot 1** e clique em **Salvar estado**.
2. A máquina fica pausada, o slot mostra uma data e a miniatura da tela, e a mensagem confirma a gravação. Anote a posição e a aparência do personagem. Salvar substitui o conteúdo anterior do slot escolhido.
3. Clique em **Iniciar**, mova o personagem para outro lugar e pressione Z/A para mudar sua aparência. Selecione Slot 1 e clique em **Carregar estado**.
4. A tela volta ao ponto e à aparência guardados, em pausa. As setas não avançam a partida até clicar em **Iniciar**.
5. Crie outro ponto em **Slot 2** e um terceiro em **Slot 3**. Carregue cada um e confira que retornam aos respectivos pontos. Os três slots do jardim são independentes.
6. Recarregue a página, abra novamente o jardim e carregue um dos slots. O ponto deve continuar disponível neste navegador e endereço.
7. Abra 2048 e confira os slots desse cartucho. Eles não reutilizam os pontos do jardim. Se já houver estados antigos de 2048, eles podem aparecer normalmente.

Cada slot é identificado pelo SHA-256 da ROM. Mudar somente o nome de um arquivo próprio não cria outro grupo de slots; mudar seus bytes cria outro cartucho para esse armazenamento.

## Exportar o ponto atual e importar

1. Volte ao jardim, retome e mova o personagem para uma posição diferente das três anteriores. Solte as teclas e selecione um slot. Clique em **Exportar estado**, sem salvar esse novo ponto no slot primeiro.
2. O navegador baixa um arquivo `.pocketstate` e a máquina fica pausada. O conteúdo representa o ponto atual exportado. A exportação não substitui o estado que já estava no slot.
3. Clique em **Iniciar**, mude a posição e a aparência. Selecione **Slot 3**, clique em **Importar estado** e escolha o arquivo baixado.
4. A posição exportada deve voltar, em pausa, e a mensagem confirma a importação no Slot 3. Use **Iniciar** para continuar. O slot selecionado é o destino da importação, mesmo que o nome do arquivo indique outro número.
5. Recarregue a página, abra o jardim e carregue Slot 3 para confirmar a persistência. Guarde o arquivo como backup; ele pode ser usado em outro navegador com os mesmos bytes de ROM.

Se o navegador permitir carregar o estado, mas recusar a gravação do slot, a interface informa os dois resultados. Nesse caso, a máquina estará no ponto importado em pausa, mas o arquivo deve ser mantido porque o slot não foi gravado.

## Rejeitar arquivos incompatíveis

1. Com 2048 aberto, tente importar o arquivo exportado do jardim. A interface deve dizer que o estado pertence a outro cartucho. A partida de 2048 não deve ser substituída pelo jardim.
2. Para conferir um arquivo inválido sem alterar seu backup, crie outro arquivo na raiz do projeto com os comandos abaixo:

```powershell
New-Item -ItemType Directory -Force -Path .work | Out-Null
Set-Content -LiteralPath .work/invalid.pocketstate -Value 'arquivo de teste invalido' -Encoding utf8
```

3. Importe `.work/invalid.pocketstate`. A interface deve apresentar um erro de arquivo inválido, sem substituir CPU, memória ou cartucho. Se uma validação profunda pausar a partida, **Iniciar** retoma o ponto que já estava aberto.
4. Volte ao jardim e importe o backup válido novamente. Ele deve continuar utilizável.

O formato limita arquivos a 1 MiB e valida versão, modelo DMG-CPU-B, SHA-256 da ROM, checksum e os campos internos. Nenhuma ROM acompanha o `.pocketstate`. Consulte [conteúdo e validação dos estados](save-states.md).

## Celular opcional

Para testar toque e layout em um celular na mesma rede Wi-Fi, interrompa o servidor com Ctrl+C e execute:

```powershell
npm.cmd run dev -- --host 0.0.0.0
```

Abra no celular o endereço de rede mostrado pelo Vite, usando o IP do seu computador. A conexão depende da rede e do firewall local. HTTP nesse endereço pode manter o jogo sem som por faltar um contexto seguro para AudioWorklet. O teste local não exige hospedagem nem serviço pago.

Confira retrato, paisagem, direcional e dois botões simultâneos. Soltar o dedo deve liberar a entrada. Os painéis podem ficar abaixo do console; role até os slots para salvar e depois volte à tela para conferir o retorno. Para testar áudio, use um acesso HTTPS compatível ou o localhost no computador.

## Validação automatizada e limites

Na raiz do projeto:

```powershell
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run test:hardware
```

Na primeira execução dos testes de navegador, instale Chromium com `npx.cmd playwright install chromium`. A preparação das ROMs externas pode usar a rede e verifica os hashes dos downloads.

O resultado externo esperado continua sendo **87 testes aprovados**: instruções, timing, LCD, dmg-acid2, 12 casos de MBC1 e 12 `dmg_sound`. A suíte de estados cobre restauração atômica, persistência, erros de formato e continuação determinística, incluindo PCM na mesma taxa de amostragem. As contagens de testes unitários e de navegador podem mudar conforme a cobertura cresce.

A PPU continua por scanline, sem pixel FIFO ou alterações durante o modo 3. A inicialização pós boot é limitada ao modelo documentado. Os testes de áudio observáveis pela CPU não equivalem a uma comparação acústica completa. MBC1M e cartuchos MBC2, MBC3 e MBC5 permanecem fora da execução atual.

Registre problemas com o passo executado, o resultado observado e o navegador ou dispositivo. M06, M07 e M08 foram aprovadas; o desenvolvimento segue com o grupo M09 a M11 autorizado.

# Controles e preferências da M09

A M09 acrescenta remapeamento de teclado, preferências locais, controles USB ou Bluetooth com mapeamento padrão e tela cheia. Os grupos M00 a M02, M03 a M05 e M06 a M08 foram aprovados pelo proprietário. M09 está concluída, dentro do grupo autorizado M09 a M11. A próxima pausa será após a M11, com um roteiro completo de revisão.

## Configurar o teclado

Abra **Controles e preferências**. O painel pausa a partida para permitir ajustar os comandos. Cada campo mostra as teclas atuais de uma ação. Clique no campo, ou alcance-o com Tab, e pressione a tecla substituta. A alteração vale imediatamente. Para jogar de novo, clique em **Iniciar**.

| Ação     | Mapa padrão               |
| -------- | ------------------------- |
| Cima     | Seta para cima            |
| Baixo    | Seta para baixo           |
| Esquerda | Seta para a esquerda      |
| Direita  | Seta para a direita       |
| Botão A  | Z                         |
| Botão B  | X                         |
| Start    | Enter                     |
| Select   | Shift esquerdo ou direito |

Tab continua navegando entre os campos. Esc retira o foco do campo sem substituir a tecla. **Restaurar teclado padrão** recupera o mapa da tabela, incluindo as duas teclas Shift em Select.

Cada ação precisa de uma tecla válida. Uma tecla não pode servir a duas ações ou se repetir dentro do mapa. Em caso de conflito, a interface apresenta uma mensagem e mantém a configuração anterior. Para trocar duas teclas entre si, use uma terceira tecla livre como etapa intermediária.

O mapa usa códigos físicos, como `KeyZ`, `ArrowUp` e `NumpadEnter`. A tecla fica vinculada à posição reconhecida pelo navegador, independentemente da letra produzida por um layout de teclado. São aceitos letras, números, setas, espaço, pontuação, teclas de edição e teclado numérico. Shift esquerdo e direito também podem ser usados. Tab, Escape, Ctrl, Alt, Meta e teclas de função ficam reservados, assim como combinações com Ctrl, Alt ou Command.

Enquanto o jogo executa, o teclado ignora campos editáveis e eventos já tratados pela interface. Enter preserva a ativação nativa de botões, links e resumos de painéis. Espaço, quando remapeado, também preserva a ativação nativa de botões e resumos. Soltar uma tecla continua liberando sua fonte mesmo que o foco tenha mudado desde o pressionamento.

## Preferências e armazenamento

As preferências usam a chave `pocketlab.preferences` em localStorage, com formato versionado e validação ao carregar. Elas contêm:

- Paleta da tela: DMG, Pocket ou Light.
- Volume e estado de mute.
- Mapa das oito ações do teclado.

Esses ajustes pertencem ao navegador, perfil e origem do site. Não há conta ou sincronização em nuvem. Mudar de `localhost` para `127.0.0.1`, usar outro navegador ou apagar os dados do site pode apresentar as preferências padrão.

localStorage é separado do IndexedDB que contém bateria e slots. Restaurar o teclado padrão não apaga progresso. Se o navegador bloquear a leitura das preferências ou os dados forem inválidos, a interface usa o padrão e informa o problema. Se bloquear a gravação, o ajuste atual funciona durante a sessão, acompanhado de um aviso.

O volume persistido não autoriza reprodução automática. Ao abrir ou recarregar a página, **Ativar som** continua sendo necessário para preparar o AudioContext por gesto. Carregar um slot ou importar um estado também não ativa áudio por conta própria. Consulte [áudio e execução](audio-runtime.md).

## Controles USB e Bluetooth

Conecte ou pareie o controle pelo sistema operacional. Com a página aberta e em foco, pressione um botão para que o navegador reconheça o dispositivo. O painel informa quantos controles com mapeamento padrão estão disponíveis. Controles sem esse mapeamento recebem uma mensagem para usar teclado ou toque.

A integração lê `navigator.getGamepads()` e aceita dispositivos conectados cujo `mapping` seja `standard`. O código do jogo recebe as mesmas oito ações do teclado e dos botões na tela.

| Índice padrão | Ação no emulador    |
| ------------- | ------------------- |
| Botão 0       | A                   |
| Botão 1       | B                   |
| Botão 8       | Select              |
| Botão 9       | Start               |
| Botão 12      | Cima                |
| Botão 13      | Baixo               |
| Botão 14      | Esquerda            |
| Botão 15      | Direita             |
| Eixo 0        | Esquerda ou direita |
| Eixo 1        | Cima ou baixo       |

Os nomes impressos nos botões variam entre fabricantes. O mapeamento segue os índices fornecidos pelo navegador. O analógico esquerdo usa uma zona neutra com histerese: ativa a direção ao atingir magnitude de 0,55 e mantém a pressão até voltar a 0,35. Isso evita alternar repetidamente entre solto e pressionado por pequenas oscilações do eixo.

Cada botão, eixo e controle possui uma fonte independente. Teclado, toque, direcional digital e analógico podem atuar juntos. Soltar uma fonte não solta uma ação que outra fonte ainda mantém pressionada. Desconectar um controle libera apenas suas entradas, preservando os demais controles, teclado e toque.

Pausa, perda de foco da janela, aba oculta e desmontagem liberam as fontes do gamepad. Enquanto a página estiver sem foco ou oculta, o polling não reaplica botões mantidos pressionados. Recuperar o foco permite ler novamente o controle quando a emulação estiver ativa. O teclado e o toque também possuem suas rotinas de liberação; ao ocultar a aba, a reprodução pausa e exige **Iniciar** para continuar.

Se a API estiver ausente ou o navegador negar acesso, teclado e toque continuam disponíveis. O suporte depende também do navegador, sistema operacional, pareamento e mapeamento anunciado pelo dispositivo. Os testes automatizados usam controles simulados; a validação de um controle físico ainda depende do teste do proprietário.

## Tela cheia

Com um cartucho aberto, **Tela cheia** solicita o modo nativo para o console. O botão passa a **Sair da tela cheia** quando a solicitação é aceita. Também é possível sair pelo comando do próprio navegador, normalmente Esc. A aplicação acompanha a mudança de modo, inclusive quando a saída acontece fora do botão.

Se o recurso não existir ou a solicitação for recusada, uma mensagem explica a indisponibilidade e a página continua funcionando no tamanho normal. Esse fallback mantém a aparência e os comandos do console.

## Navegação e acessibilidade

O link **Ir para o console** aparece ao receber foco por teclado e permite saltar o cabeçalho. A navegação mantém foco visível; campos possuem rótulos e os controles apresentam nome e estado acessíveis. Tab percorre a interface, e os botões do console podem ser ativados por teclado, toque ou ponteiro.

Mensagens de configuração, áudio, gamepad e armazenamento são expostas como status. As preferências de movimento reduzido do sistema são respeitadas. A tela do jogo mantém a renderização por pixels e pode receber foco para a entrada por teclado.

Esses recursos não equivalem a uma certificação WCAG ou a uma validação completa com leitores de tela. O conteúdo visual das ROMs depende de cada jogo, e o Canvas não transforma automaticamente esse conteúdo em uma descrição textual da partida.

## Conferir a M09

1. Execute `npm.cmd run dev` e abra o endereço mostrado. Pressione Tab até **Ir para o console** e ative-o. O foco e a navegação devem alcançar o console sem percorrer o cabeçalho inteiro.
2. Abra o jardim e use **Iniciar**. Abra **Controles e preferências**. A partida deve pausar. No campo de Cima, pressione W. A legenda e o campo devem mostrar a mudança. Retome e confirme que W move o personagem para cima.
3. Tente usar W em outra ação. A mensagem deve indicar conflito, e os dois mapas anteriores devem ser preservados. No campo, Tab deve avançar e Esc deve retirar o foco sem virar um comando de jogo.
4. Escolha outra paleta, altere o volume e recarregue a página no mesmo endereço. Os ajustes e W devem permanecer. O áudio deve continuar desligado até **Ativar som**. **Restaurar teclado padrão** deve recuperar as teclas da tabela.
5. Durante a execução, navegue até o resumo do painel e pressione Enter. Ele deve abrir normalmente. Se tiver remapeado uma ação para Espaço, essa tecla deve continuar ativando botões e resumos quando eles tiverem foco.
6. Abra **Tela cheia** e saia pelo botão ou Esc. O console deve manter os comandos acessíveis e a imagem sem suavização. Em um navegador sem suporte, espere uma mensagem útil e a continuação na página normal.
7. Opcionalmente, conecte um controle físico padrão e pressione um botão. Confira a indicação de conexão, direcional, analógico esquerdo, A, B, Select e Start em um jogo que use essas ações. Teste junto com teclado ou toque, desconecte o controle e confirme que não há direção presa. Esse passo é a validação física pendente do proprietário.

O [roteiro M06 a M08](testing-m06-m08.md) permanece disponível para conferir bateria, áudio e slots. O roteiro conjunto de M09 a M11 será entregue na pausa após a M11.

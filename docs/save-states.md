# Estados salvos da M08

Um estado guarda a máquina Game Boy no ponto capturado. Isso permite voltar à posição, tela e andamento da partida independentemente de o jogo oferecer um menu de save. O recurso funciona com os cartuchos atualmente suportados, incluindo o jardim de diagnóstico.

## Usar os três slots

Abra um cartucho e encontre o painel **Um ponto para voltar.**. Existem três slots para cada SHA-256 de ROM. Renomear o mesmo arquivo mantém os slots; mudar os bytes do cartucho cria outra identidade.

| Ação                | Resultado                                                                               |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Salvar estado**   | Pausa a máquina, captura o ponto atual e substitui o slot selecionado.                  |
| **Carregar estado** | Valida e restaura o slot selecionado, mantendo a partida em pausa.                      |
| **Exportar estado** | Pausa e baixa o ponto atual em `.pocketstate`, mesmo sem um slot salvo.                 |
| **Importar estado** | Valida o arquivo para o cartucho aberto, restaura em pausa e grava no slot selecionado. |

Depois de salvar, carregar, exportar ou importar, use **Iniciar** para continuar. Exportar não altera o conteúdo de um slot. Na importação, o slot selecionado na interface é o destino, mesmo quando o arquivo foi exportado de outro slot.

Cada slot mostra a data e uma miniatura da tela capturada. Enquanto uma operação está pendente, reprodução, troca de cartucho e avanço manual ficam bloqueados para que o estado pertença à mesma sessão do começo ao fim.

Se a importação carregar a máquina, mas o navegador recusar a gravação local, a interface distingue os resultados: o ponto estará carregado em pausa, mas o slot não foi gravado. Guarde o arquivo exportado e confira a mensagem antes de fechar a página.

Os slots ficam no navegador e na origem do site, sem conta ou sincronização em nuvem. Limpar os dados do site, usar outro perfil ou mudar entre endereços como `localhost`, `127.0.0.1` e o domínio publicado pode apresentar outro conjunto de saves. Exporte arquivos para manter um backup independente desses dados locais.

## Bateria e estado completo

A bateria preserva a RAM que o próprio código do jogo decide gravar. Ela pode conter recordes, opções ou progresso, conforme cada jogo. Não garante recuperar a posição exata da partida.

O estado inclui essa RAM, mesmo em cartuchos sem bateria, e também o restante da máquina. Restaurar um estado antigo pode voltar os dados de bateria ao conteúdo que existia na captura. Quando esses bytes mudam, a revisão da bateria é invalidada para que o autosave reconheça o novo conteúdo. O número de revisão atual não é substituído por um número antigo do arquivo.

IndexedDB v2 acrescenta a coleção de estados e preserva a coleção de bateria existente, cujo formato continua na versão 1. Atualizar a aplicação não exige apagar o banco anterior.

## Conteúdo capturado

| Componente             | Dados preservados                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CPU                    | Registradores, flags, PC, SP, IME e ativação adiada, HALT, HALT bug, STOP e ciclos.                                              |
| Memória e interrupções | WRAM, HRAM, VRAM, OAM, registradores do bus, IE e IF.                                                                            |
| Cartucho               | Mapper, bancos, modo, habilitação da RAM e conteúdo completo da RAM.                                                             |
| Timer e DMA            | Divisor, contadores, recarga pendente, transferência e fase em andamento.                                                        |
| PPU                    | Registradores, modos, linha e ciclos, contador da janela, sprites selecionados e framebuffer.                                    |
| Serial                 | Transferência parcial, bits e ciclos pendentes, bytes de saída e texto já apresentado pela sessão.                               |
| Joypad                 | Seleção dos grupos e botões pressionados no núcleo.                                                                              |
| APU                    | Registradores, canais, timers, fases, length, envelope, sweep, LFSR, wave RAM, acesso à wave, sequenciador, amostrador e filtro. |

A captura ocorre com a execução pausada, entre instruções. Os arrays são copiados para que o estado não compartilhe memória mutável com a máquina. No carregamento pela interface, as entradas físicas são liberadas para evitar uma tecla ou toque preso; o usuário pode pressionar novamente ao retomar.

## Formato e validação

O arquivo `.pocketstate` usa JSON UTF-8 com representação explícita dos arrays de bytes. O arquivo contém os dados do estado, sem incluir a ROM. É necessário abrir um cartucho com os mesmos bytes para restaurá-lo.

O envelope registra:

- Formato `PocketLab`, versão 1.
- Modelo `DMG-CPU-B` e SHA-256 da ROM.
- Data da captura e slot de origem.
- Payload de sessão e núcleo na versão 1, com versões próprias dos componentes.
- Checksum SHA-256 dos metadados e do payload normalizado.

O limite de um arquivo é **1 MiB**. A leitura confere formato, tamanho, versão, modelo, ROM, checksum, tipos, intervalos numéricos e tamanhos de buffers. Chaves reservadas, tipos desconhecidos, valores não finitos e estruturas excessivas são rejeitados. O checksum identifica corrupção ou alteração dos dados; não substitui a validação dos componentes.

O núcleo valida a restauração em uma máquina candidata antes de aplicar o estado à máquina atual. Um campo inválido, mesmo em um componente verificado por último, não deixa a máquina parcialmente restaurada. A interface pode pausar antes da validação profunda, mas uma rejeição não substitui CPU, memória ou cartucho. Os bytes do slot recusado também são preservados para diagnóstico.

Não há compatibilidade prometida com formatos de outros emuladores ou versões futuras do núcleo. Uma versão incompatível recebe uma mensagem em vez de uma tentativa de adaptação silenciosa.

## Continuação de áudio

O estado preserva o intervalo parcialmente acumulado pelo amostrador e os capacitores do filtro passa-altas, além dos quatro canais e do sequenciador ligado ao DIV. Na mesma taxa de amostragem, os testes verificam que a continuação produz PCM idêntico, incluindo capturas feitas no meio de um intervalo de amostragem.

PCM já enfileirado para apresentação não faz parte do estado. A restauração limpa as filas do núcleo e do AudioWorklet, invalida respostas antigas por geração e deixa a máquina pausada. Descartar essas filas preserva a fase do amostrador e o filtro. Volume, mute e a autorização de áudio pertencem à sessão do navegador.

O arquivo registra a taxa de amostragem usada na captura. Se houver um AudioContext conectado com outra taxa, o Worker reconfigura o amostrador para a taxa real do dispositivo após restaurar os canais e a máquina. Essa mudança não promete PCM idêntico entre taxas diferentes. Sem essa diferença, a fase salva é preservada. Consulte a [arquitetura de áudio](audio-runtime.md).

## Conferir a entrega

O [roteiro M06 a M08](testing-m06-m08.md) mostra como testar slots, retorno à posição do jardim, persistência, exportação do ponto atual, importação e rejeição de arquivos inválidos. O grupo foi aprovado pelo proprietário.

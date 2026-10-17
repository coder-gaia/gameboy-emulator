# Rascunho para LinkedIn

Texto para revisão do proprietário. Não foi publicado. A versão mencionada é a candidata **1.0.0-rc.1**; o aceite de fluidez com áudio no aparelho real permanece pendente.

## Texto do post

Construí um emulador de Game Boy para jogar e explorar o hardware direto no navegador.

O nome é Pocket Lab. A interface lembra um console de bolso, mas também permite abrir um painel com instruções, memória, tiles, sprites e registradores da máquina que está executando o jogo.

Por trás da tela, o núcleo usa TypeScript e roda em um Web Worker. CPU, vídeo, timer e áudio avançam em T-cycles. React apresenta a interface, e um AudioWorklet cuida da saída PCM.

Também implementei saves de bateria, slots de estado, rewind com memória limitada e controles por teclado, toque e gamepad padrão. Dá para começar pelos homebrews autorizados da biblioteca ou pelo jardim que criei para testar o emulador. Cartuchos próprios ficam no dispositivo, sem upload ou conta.

Um dos desafios mais interessantes foi distinguir velocidade da máquina, continuidade do áudio e fluidez dos quadros apresentados. Um teste no Motorola revelou um problema que a simulação no desktop não havia mostrado. A música já deixou de picotar no aparelho testado; a revisão da fluidez com áudio ainda está em andamento.

Estou compartilhando a candidata como beta, com testes e limitações documentados. O deploy usa arquivos estáticos no Cloudflare Pages, sem backend.

[Experimentar o Pocket Lab](https://gameboy-emulator-aox.pages.dev/)

[Código e documentação](https://github.com/coder-gaia/gameboy-emulator)

#TypeScript #Emulação #DesenvolvimentoWeb

## Mídia e legenda

Usar [a captura do desktop](media/pocket-lab-desktop.png) como imagem de abertura. O [GIF do jardim](media/pocket-lab-garden.gif) mostra interação real com a ROM própria e pode acompanhar uma demonstração separada. Nenhum desses arquivos foi publicado em rede social.

Legenda acessível sugerida: “Pocket Lab executando o jardim próprio dentro de um console de Game Boy desenhado na página. O personagem responde aos direcionais e muda de aparência. Ao lado, a biblioteca oferece Tobu Tobu Girl e 2048.”

A [imagem de layout móvel](media/pocket-lab-mobile.png) foi capturada em Chromium com viewport de celular emulado. Caso seja utilizada, identificar essa origem. O GIF não possui áudio e sua conversão para 12 fps não demonstra a taxa de apresentação da aplicação. A [nota das capturas](media/README.md) preserva os detalhes.

Antes de publicar, revisar o estado da candidata e o retorno do teste real no Motorola. Enquanto esse aceite estiver pendente, manter a ressalva do texto. O rascunho não afirma compatibilidade universal, precisão integral ou desempenho mobile homologado.

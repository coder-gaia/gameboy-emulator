# Capturas reais do Pocket Lab

Arquivos preparados em 17 de outubro de 2026, no fuso America/Sao_Paulo, para o portfólio e os rascunhos de divulgação da candidata 1.0.0-rc.1. Nenhuma postagem foi realizada.

| Arquivo                                          | Conteúdo                                               | Origem                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [pocket-lab-desktop.png](pocket-lab-desktop.png) | Interface e jardim no desktop.                         | Chromium, viewport de 1440 por 1100 CSS px, DPR 1.                                                                    |
| [pocket-lab-mobile.png](pocket-lab-mobile.png)   | Layout de toque com setas maiores.                     | Chromium no computador, perfil Pixel 7 emulado, viewport de 390 por 844 CSS px e DPR 2,625. Não é um telefone físico. |
| [pocket-lab-garden.gif](pocket-lab-garden.gif)   | Movimento, troca de aparência e retorno do personagem. | Vídeo real da aplicação controlada por teclado via Playwright, recortado para o console e convertido por FFmpeg.      |

Os PNGs foram atualizados sobre o artefato final v3 congelado da candidata 1.0.0-rc.1 na M14, com entrada `index-D-vFVJfv.js`, SHA-256 `e0da6f926080f7b52d9eaf91b003134702dd7ac68dbf01c2f8cc014b6465c839`. O diálogo Sobre confirmou a versão e o estado de candidata em validação nos dois perfis. Os PNGs não receberam edição.

O GIF preserva a captura do artefato congelado da M13, commit `cb9d2d9bc97e9a618a50d9c150a63c182163185e`, cujo HTML e assets foram comparados com a publicação pública. Ele contém 48 quadros em quatro segundos, 400 por 585 pixels, com conversão para 12 fps e paleta de até 128 cores, sem interpolação. Essa cadência pertence ao arquivo de divulgação e não mede FPS ou velocidade da aplicação.

O jogo mostrado é POCKET GARDEN, criação própria. O áudio não foi ativado durante a captura. Não há ROM comercial, cenário externo ou imagem gerada substituindo a aplicação. Textos dos jogos da biblioteca aparecem na interface; seus autores e permissões continuam registrados nos [créditos](../third-party.md).

Conferência de aparência na captura: fundo calculado `rgb(238, 233, 223)`, equivalente a `#eee9df`; console com opacidade `1`, sem filtro, preservando o gradiente original. Nenhuma sobreposição foi aplicada ao Game Boy.

A origem móvel emulada deve acompanhar a imagem quando for apresentada como evidência de layout. Nenhum arquivo comprova homologação do áudio ou da fluidez no Motorola Edge 40 Neo. O [roteiro manual](../testing-m12-m14.md) registra esse aceite pendente.

Os scripts da captura inicial, vídeo de origem e metadados locais ficaram em `.work/m14-media/`. A atualização dos PNGs e as evidências da versão estão em `.work/m14-visual/` e `.work/m14-visual-check.json`, fora do versionamento. As imagens são demonstrações da interface, não benchmarks ou declaração de uma licença geral para o código do projeto.

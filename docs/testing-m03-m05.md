# Testar M03, M04 e M05

O segundo grupo adiciona timers, interrupções, DMA, vídeo, sprites, janela e controles. O desenvolvimento está pausado para a revisão do proprietário antes da M06. Não é necessário obter um jogo para fazer este teste: POCKET GARDEN é uma ROM própria incluída na aplicação.

## Abrir o projeto

Na raiz do projeto, com Node.js 22.12 ou superior, execute no PowerShell:

```powershell
npm.cmd ci
npm.cmd run dev
```

Se as dependências já estiverem instaladas e o lockfile não tiver mudado, basta o segundo comando. Abra o endereço exibido no terminal, normalmente `http://127.0.0.1:5173`.

## Jardim e controles

1. Clique em **Explorar jardim**. O header mostra POCKET GARDEN, ROM Only e 32 KiB de ROM. A tela apresenta céu, nuvens, água, jardim e caminho em quatro tons. Um pequeno personagem aparece próximo ao centro; a legenda inferior mostra POCKET GARDEN e os botões Z e X.
2. Segure uma seta por um instante. O personagem anda naquela direção e para ao soltar. O cenário e a legenda permanecem parados nesta versão. Duas setas simultâneas permitem movimento diagonal.
3. Continue andando até uma borda. O personagem permanece na área visível e não atravessa a legenda inferior.
4. Pressione **Z**, equivalente ao botão **A**. A aparência muda uma vez. Segurar Z mantém a aparência; soltar e pressionar novamente alterna para a outra versão.
5. Pressione **X**, equivalente ao botão **B**. O personagem volta à posição inicial.
6. Experimente os botões do console com o mouse ou toque. O direcional move o personagem, A muda a aparência e B recentraliza. Enter e Shift enviam Start e Select, mas o jardim não atribui ações a esses botões.

O personagem anda um pixel por quadro emulado. A fixture valida entrada e composição gráfica; ainda não tem objetivo, pontuação, áudio ou saves.

## Pausa, reinício e paletas

1. Clique em **Pausar** e tente mover o personagem. A posição permanece fixa. Clique em **Iniciar** para retomar.
2. Mova o personagem e troque entre **DMG**, **Pocket** e **Light**. Os tons mudam sem reiniciar o cartucho ou alterar a posição.
3. Clique em **Reiniciar**. A máquina volta ao começo em pausa. Clique em **Iniciar** para o programa carregar novamente o jardim e mostrar o personagem na posição inicial.
4. Com o jardim em execução, troque para outra aba e depois volte. A aplicação permanece pausada. Clique em **Iniciar**; o personagem não deve continuar andando por uma tecla que já foi solta.
5. Abra **Inspecionar CPU** enquanto a máquina estiver pausada. O painel observa a mesma máquina exibida na tela. Os comandos manuais avançam ciclos; durante HALT, os registradores podem permanecer iguais até a próxima interrupção. Para voltar ao jardim normal, use **Iniciar** ou reinicie.

Para repetir o diagnóstico de CPU do primeiro grupo, clique em **Experimentar cartucho de diagnóstico**, abra **Inspecionar CPU** e use **Até 1000 instruções**. O resultado esperado é saída serial **OK**, estado **HALT** e PC **017D**. Use **Explorar jardim** para voltar ao cenário interativo.

## Ajuda e cartucho próprio

1. Abra **Quais arquivos posso usar?**. A reprodução pausa e a ajuda explica `.gb`, `.gbc`, extração de `.zip`, compatibilidade e privacidade. Feche a ajuda e clique em **Iniciar** para continuar.
2. Se desejar testar um arquivo próprio, use **Carregar cartucho** ou **Trocar cartucho**, ou arraste o arquivo para a página. O header deve informar título, controlador, tamanho da ROM, RAM e bateria.
3. Nesta etapa, a reprodução aceita **ROM Only de 32 KiB** para o Game Boy original. O arquivo carregado começa em pausa; clique em **Iniciar** para executar. A compatibilidade de cada jogo depende dos comportamentos já implementados.
4. Cartuchos MBC1, MBC2, MBC3 ou MBC5 e jogos exclusivos de Game Boy Color ainda não executam. Seus dados podem ser identificados. `.gbc` só pode funcionar quando o jogo também é compatível com o DMG e usa um cartucho atualmente suportado.
5. Arquivos inválidos ou incompletos devem produzir uma mensagem útil. Extraia `.zip` antes; mudar apenas a extensão não converte outro arquivo em ROM. O limite de leitura é 8 MiB.
6. Clique em **Explorar jardim** para voltar à fixture incluída, mesmo depois de carregar outro arquivo.

O cartucho fica no dispositivo, sem upload para servidor. Não é necessário fornecer BIOS ou boot ROM.

## Celular opcional

Também é possível testar em um celular na mesma rede Wi-Fi do computador. Interrompa o servidor anterior com Ctrl+C e execute:

```powershell
npm.cmd run dev -- --host 0.0.0.0
```

Abra no celular o endereço de rede exibido pelo Vite, por exemplo `http://192.168.1.20:5173`. Use o IP local do seu computador, sem copiar literalmente o IP do exemplo. A conexão depende de ambos os dispositivos estarem na mesma rede e de o firewall permitir o servidor local.

No celular, **Explorar jardim** pode aparecer abaixo da área inicialmente visível. Depois de tocar no botão, volte ao console no topo da página para ver a tela e os controles.

Confira o jardim em retrato e paisagem. Use o direcional e A/B por toque, incluindo dois botões simultâneos. Soltar o dedo ou cancelar o toque deve interromper a entrada. O teste no celular é opcional e não exige serviço de hospedagem.

## Validação automatizada

Para repetir os checks do projeto:

```powershell
npm.cmd run check
npm.cmd run test:e2e
npm.cmd run test:hardware
```

Na primeira execução dos testes de navegador, instale o Chromium do Playwright com `npx.cmd playwright install chromium`. A preparação das ROMs externas pode usar a rede; os arquivos e downloads são conferidos por SHA-256.

O resultado externo esperado é **63 testes aprovados**: 62 ROMs de instruções e timing, mais dmg-acid2 com os 23.040 pixels idênticos à referência oficial. Consulte [procedência e protocolos](test-roms.md) para reproduzir essa validação.

## Limites desta entrega

- MBC1, bateria e Tobu Tobu Girl entram na M06 após a aprovação deste grupo.
- Áudio, save states e persistência ainda não estão disponíveis.
- A PPU renderiza por scanline. Pixel FIFO, escritas durante o modo 3 e peculiaridades de WX 0 e 166 ainda não são modelados.
- O site público será preparado em milestones posteriores. O roteiro atual usa o servidor de desenvolvimento local.

Ao revisar, registre qualquer problema com o passo executado, o resultado observado e o navegador ou dispositivo utilizado. O próximo grupo só começa após o ok do proprietário.

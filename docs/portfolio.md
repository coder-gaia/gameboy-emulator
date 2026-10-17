# Pocket Lab: Game Boy no navegador

Texto preparado para o portfólio da candidata **1.0.0-rc.1**, ainda em validação. A beta está disponível, mas a fluidez com áudio no Motorola Edge 40 Neo ainda precisa de aceite no aparelho real.

[Experimentar a beta](https://gameboy-emulator-aox.pages.dev/) · [Ver o código](https://github.com/coder-gaia/gameboy-emulator)

![Pocket Lab no desktop, com o jardim próprio executando no console e a biblioteca de jogos ao lado.](media/pocket-lab-desktop.png)

## Apresentação

O Pocket Lab é um emulador do Game Boy original que funciona no navegador. O visitante pode começar por dois jogos homebrew com redistribuição autorizada, explorar um jardim próprio de diagnóstico ou abrir um cartucho compatível do seu dispositivo. ROMs próprias e progresso ficam locais, sem conta, backend ou upload.

O projeto combina uma interface de console de bolso com ferramentas para observar a máquina: instruções SM83, memória, tiles, sprites, registradores e métricas de áudio. O núcleo foi escrito em TypeScript estrito e pode ser executado e testado sem navegador. React, Canvas 2D e APIs de áudio cuidam da apresentação.

## Decisões de engenharia

- **Tempo explícito:** CPU, timer, DMA, PPU e APU avançam em T-cycles. O clock emulado não depende da frequência de renderização do React.
- **Máquina fora da interface:** um Web Worker executa o núcleo. O AudioWorklet recebe PCM por mensagens e buffers transferíveis, usando a taxa real da saída de áudio.
- **Estados verificáveis:** bateria e três slots por cartucho usam IndexedDB e SHA-256 da ROM. A restauração valida uma máquina candidata antes de substituir o estado atual.
- **Histórico limitado:** rewind opcional retém até 20 segundos em uma arena de buffers de 8 MiB. O limite pertence ao histórico, não à memória total da aplicação.
- **Inspeção sem alterar o jogo:** o painel técnico lê instruções, 384 tiles, 40 sprites e páginas de memória. As consultas param quando o painel fecha ou a página fica oculta.
- **Publicação estática:** um repositório e um pacote npm, sem monorepo. O GitHub aciona o Cloudflare Pages Free. Não existe um processo de servidor para iniciar a cada acesso; download e inicialização no navegador continuam existindo.

Os controladores implementados são ROM Only, MBC1, MBC2, MBC3 com RTC quando presente e MBC5, dentro dos [limites documentados](cartridge-mappers.md). Teclado remapeável, toque, gamepad padrão, tela cheia, paletas e movimento reduzido completam a interface.

## Validação e limites

A validação combina testes determinísticos em Node, testes de interface e produção com Playwright e 103 casos externos de CPU, timing, vídeo, som e cartuchos. Revisões, hashes e licenças das ROMs de teste são registrados. As suítes e os [relatórios de desempenho](performance.md) descrevem o ambiente medido, sem tratar simulação de viewport como teste em telefone físico.

Um teste real no Motorola Edge 40 Neo revelou lentidão depois de ativar o som. A revisão do abastecimento eliminou os cortes musicais e as travadas relatadas, mas o proprietário ainda percebeu movimento lento com áudio. A candidata mantém essa validação aberta e separa velocidade emulada, frames apresentados e entrega de PCM no diagnóstico. O [registro MB01](mobile-audio-investigation.md) preserva o problema e as evidências.

O projeto não promete compatibilidade com todo jogo. A PPU usa renderização por scanline, sem pixel FIFO completo; a equivalência acústica integral também não foi demonstrada. Jogos exclusivos de Game Boy Color, MBC1M e MBC30 ficam fora do escopo atual. Consulte o [README](../README.md) para o estado atualizado e o [roteiro manual](testing-m12-m14.md) para a revisão da candidata.

## Demonstração

![Jardim próprio do Pocket Lab, com deslocamento e troca de aparência do personagem usando controles reais da aplicação.](media/pocket-lab-garden.gif)

As capturas usam o jardim próprio. O GIF veio de interação real no Chromium, sem áudio ativado, e foi convertido para 12 fps para divulgação. Ele não mede desempenho. A [captura de layout móvel](media/pocket-lab-mobile.png) usa emulação de navegador no computador; a [origem dos arquivos](media/README.md) registra esse escopo.

Stack: TypeScript, React, Vite, Canvas 2D, Web Worker, AudioWorklet, IndexedDB, Vitest, Playwright, GitHub Actions e Cloudflare Pages.

Os jogos da biblioteca pertencem aos respectivos autores e preservam seus créditos e permissões. O repositório não define, neste momento, uma licença geral de redistribuição para o código próprio. As [licenças de terceiros](third-party.md) não devem ser apresentadas como licença de todo o projeto.

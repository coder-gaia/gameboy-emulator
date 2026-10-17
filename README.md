# Pocket Lab

[![Quality](https://github.com/coder-gaia/gameboy-emulator/actions/workflows/ci.yml/badge.svg)](https://github.com/coder-gaia/gameboy-emulator/actions/workflows/ci.yml)

Um Game Boy DMG no navegador, escrito em TypeScript. Jogue, volte alguns segundos e explore o hardware que faz cada pixel acontecer.

**[Abrir Pocket Lab](https://gameboy-emulator-aox.pages.dev/)** · [Como testar](docs/testing-m12-m14.md) · [Milestones](docs/milestones.md)

![Console Pocket Lab com o jardim original](docs/media/pocket-lab-desktop.png)

Versão **1.0.0-rc.1**, candidata a lançamento. O desktop foi aprovado pelo proprietário. No Motorola Edge 40 Neo com Chrome, a M12 eliminou travadas e cortes da música, mas ainda houve lentidão percebida somente com som. A M14 trata a apresentação dos quadros intermediários. O aceite dessa mudança no aparelho real continua pendente; testes com viewport móvel em computador não o substituem.

## Experimente

Escolha **Tobu Tobu Girl** ou **2048** na biblioteca e comece sem arquivo. **Controles e créditos dos jogos** apresenta as ações, autores e licenças. **Explorar jardim** abre uma ROM original de diagnóstico, sem trilha sonora.

Para jogar um cartucho próprio, use **Carregar cartucho** ou arraste um arquivo `.gb`. Arquivos `.gbc` precisam funcionar também no Game Boy original; extraia `.zip` antes. A ajuda **Quais arquivos posso usar?** explica os formatos perto do carregamento. Os bytes permanecem no dispositivo, sem upload, conta ou backend. Não é necessário fornecer BIOS ou boot ROM.

| Recurso           | Como usar                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Teclado e toque   | Setas, Z para A, X para B, Enter para Start e Shift para Select. Remapeamento em **Controles e preferências**.   |
| Áudio estéreo     | **Ativar som** após abrir um jogo. Exige AudioWorklet em HTTPS ou localhost. Volume e mute não pausam a máquina. |
| Saves de bateria  | Progresso gravado pelo próprio jogo, salvo automaticamente neste navegador por SHA-256 do cartucho.              |
| Save states       | Três slots por cartucho e arquivos `.pocketstate`. Salvar ou carregar pausa a máquina.                           |
| Rewind            | Ative, jogue e segure R ou **Segure para voltar**. Histórico temporário de até 20 segundos, limitado a 8 MiB.    |
| Inspeção          | CPU, desassemblador, memória, 384 tiles, 40 sprites, PPU, timer, DMA, interrupções e RTC.                        |
| Diagnóstico local | **Desempenho e áudio**, medição de 60 segundos e JSON sem ROM, memória ou progresso.                             |

O jardim usa instruções SM83, tiles, mapas e OAM da máquina emulada. Setas movem o personagem, A alterna a aparência e B retorna ao início. Teclado, toque e gamepad padrão podem enviar as mesmas ações. A aba oculta pausa a execução.

![Movimento real no jardim original](docs/media/pocket-lab-garden.gif)

Saves e preferências pertencem ao navegador e à origem do site. Limpar seus dados os remove. Exporte estados como backup antes de trocar de dispositivo ou endereço. Não há sincronização em nuvem.

## Arquitetura

Um repositório e um pacote npm, **sem monorepo**. React, Vite e CSS Modules compõem a interface; o núcleo estrito em `src/core` roda em Node e não importa DOM, React, Web Audio ou armazenamento. Quatro T-cycles equivalem a um M-cycle.

```mermaid
flowchart LR
  UI[React e controles] -->|comandos| Worker[Web Worker]
  Worker --> Core[CPU, bus, PPU e APU]
  Worker <-->|PCM e demanda| Audio[AudioWorklet]
  Worker -->|quadros transferíveis| Canvas[Canvas 160 x 144]
  Audio -->|cursor PCM| Canvas
  UI --> Storage[IndexedDB e preferências locais]
```

Sem áudio, um relógio monotônico controla o orçamento de T-cycles. Com áudio, o Worklet solicita PCM na taxa real do dispositivo. A reserva se adapta ao atraso do transporte; quadros intermediários usam buffers limitados e são apresentados por requestAnimationFrame conforme o PCM avança. A solução usa MessageChannel e transferências, sem SharedArrayBuffer ou exigência de COOP/COEP.

[Áudio e apresentação](docs/audio-runtime.md), [estados salvos](docs/save-states.md), [rewind](docs/rewind.md), [inspeção](docs/debugger-core.md) e [métricas](docs/performance-metrics.md) detalham contratos e limites.

## Compatibilidade e limites

| Cartucho | ROM máxima | RAM e particularidades                                                           |
| -------- | ---------- | -------------------------------------------------------------------------------- |
| ROM Only | 32 KiB     | Sem banking.                                                                     |
| MBC1     | 2 MiB      | Fiação padrão: até 32 KiB de RAM para ROM até 512 KiB; até 8 KiB para ROM maior. |
| MBC2     | 256 KiB    | 512 nibbles internos.                                                            |
| MBC3     | 2 MiB      | Até 32 KiB de RAM; RTC quando declarado pelo cartucho.                           |
| MBC5     | 8 MiB      | Até 128 KiB de RAM; variante rumble até 64 KiB, sem vibração física.             |

O tamanho de ROM deve ser potência de dois. A convenção homebrew de 2 KiB de RAM é aceita com aviso. MBC1M, MBC30, jogos exclusivos de Game Boy Color e link cable ficam fora do escopo. [Controladores e RTC](docs/cartridge-mappers.md).

A PPU usa scanlines, sem pixel FIFO, mudanças dentro do modo 3 ou peculiaridades de WX 0 e 166. A inicialização pós boot não reproduz todas as revisões físicas. Os testes `dmg_sound` verificam comportamento observável pela CPU e não comprovam equivalência acústica integral. A reserva de áudio pode introduzir latência; navegador, carga e saída física também influenciam a experiência. Gamepad e leitores de tela físicos ainda precisam de revisão manual.

## Executar e validar

Requer Node.js 22.12 ou superior e npm. O ambiente de build está fixado em `.node-version`.

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run dev
```

Abra o endereço exibido. Os exemplos usam `npm.cmd` para funcionar no PowerShell com scripts desabilitados; em outros shells, use `npm`.

```powershell
npm.cmd run check
npm.cmd run test:hardware
npm.cmd run test:e2e
npm.cmd run test:production
npm.cmd run test:audio-flow
```

`check` verifica regras, formatação, lint, testes locais, tipos e build. Hardware prepara fixtures com revisão e SHA-256 fixados e executa **103 casos externos** de Blargg, Mooneye e dmg-acid2. Produção aplica CSP ao artefato compilado. A regressão de transporte mede áudio, T-cycles e desenhos reais sob atraso controlado; não homologa celular físico.

[Procedência dos testes](docs/test-roms.md), [metodologia de desempenho](docs/performance.md) e [investigação mobile](docs/mobile-audio-investigation.md). Os resultados de cada entrega ficam no [acompanhamento](docs/milestones.md) e no GitHub Actions.

## Publicação e apresentação

O site é estático no **Cloudflare Pages Free**, conectado ao GitHub. Um push em `main` dispara o deploy, sem servidor para inicializar na visita. Download e inicialização no navegador continuam existindo. O [guia de deploy](docs/deployment.md) explica o painel, a configuração e a conferência da publicação.

[Notas da candidata](docs/release-notes.md), [estudo para portfólio](docs/portfolio.md) e [rascunho para LinkedIn](docs/linkedin.md) apresentam o projeto e seus limites. Os textos são materiais para revisão do proprietário, sem publicação automática.

O [plano original](plano-emulador-gameboy.md) permanece preservado. Os roteiros [M00 a M02](docs/testing-m00-m02.md), [M03 a M05](docs/testing-m03-m05.md), [M06 a M08](docs/testing-m06-m08.md) e [M09 a M11](docs/testing-m09-m11.md) registram os grupos anteriores. O teste atual está em [M12 a M14](docs/testing-m12-m14.md).

## Conteúdo de terceiros

Não há jogo comercial ou boot ROM original distribuído. Tobu Tobu Girl e 2048 são homebrews com redistribuição autorizada, binários originais e créditos no site. [Jogos e licenças](docs/demo-games.md).

POCKET TEST e POCKET GARDEN, incluindo cenário, personagem e letras, são criações próprias. As ROMs externas ficam restritas aos testes. DM Sans e Space Mono são fornecidas localmente por Fontsource. [Créditos de terceiros](docs/third-party.md).

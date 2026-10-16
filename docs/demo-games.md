# Jogos demonstrativos da M06

A biblioteca contém Tobu Tobu Girl e 2048 para Game Boy. São jogos homebrew completos, distribuídos pelos próprios autores com permissões explícitas. Os bytes originais das ROMs não foram alterados. Os arquivos são servidos pelo próprio site e não exigem conta, serviço externo ou upload do visitante.

O catálogo tipado está em `src/platform/games/catalog.ts`. O manifesto técnico em `public/games/manifest.json` fixa procedência, revisão, licença, header e SHA-256. As licenças e atribuições acompanham cada jogo e devem continuar presentes no deploy.

## Tobu Tobu Girl

Jogo de plataforma de Tangram Games, com trilha sonora de potato-tan. A edição selecionada é a original para Game Boy, não a edição Deluxe. A ROM possui 256 KiB, controlador MBC1, 8 KiB de RAM, bateria e header de versão 1.

- [Página oficial](https://tangramgames.dk/tobutobugirl/).
- [Download gratuito oficial no itch.io](https://tangramgames.itch.io/tobutobugirl), upload 678889.
- [Fonte e licenças em revisão fixa](https://github.com/SimonLarsen/tobutobugirl/tree/048a22c2d7ebbe25811322e8692803fa86bb643a).
- Arquivo incluído: `public/games/tobu-tobu-girl/tobu.gb`.

```text
SHA-256 da ROM:
5d3871cae77db2287807e8914fd21f76203e73aa3fec20955489d45cb4571d8f

SHA-256 do ZIP oficial:
c5ec138071079b9cad227d6fb875ad4e58a77f173ed3cd8758c04c0ab166d6e7
```

Para reproduzir a obtenção, baixe gratuitamente o pacote oficial no itch.io e extraia `tobutobugirl/tobu.gb`. Confira o SHA-256 antes de substituir o arquivo versionado. A revisão da fonte registra a declaração de licença; não houve recompilação do binário no Pocket Lab.

O código usa MIT. Todos os assets, incluindo imagens, texto, som e música, usam CC BY 4.0 conforme a declaração dos autores. `LICENSE-MIT.txt` preserva o aviso original; `ASSETS-LICENSE.txt`, `UPSTREAM-README.md` e `ATTRIBUTION.txt` registram a declaração, atribuição e links da licença.

O driver musical mmlgb, de Simon Larsen, também usa MIT e tem seu aviso preservado em `LICENSE-MMLGB-MIT.txt`. O manifesto fixa a revisão `eb42b8964d53df061e21c9c4fbf223f257a67b2a` apontada pelo submódulo do jogo e, separadamente, a revisão `aa0864d4391490057760a2a84dd4ab117f0b04e8` do aviso MIT oficial consultado.

A abertura original mostra os logos dos autores e uma animação antes do título. Start pode pular essa animação; no título, pressione Start novamente e confirme a fase com A. Os logos e a animação permanecem intactos.

| Entrada no Pocket Lab | Ação no jogo                                            |
| --------------------- | ------------------------------------------------------- |
| Enter ou Start        | Começa e pausa                                          |
| Setas                 | Movem a personagem e escolhem a direção do impulso      |
| Z ou A                | Dá um impulso na direção escolhida                      |
| X ou B                | Voa enquanto o botão permanece pressionado e há energia |

## 2048 para Game Boy

Versão de Sanqui (Sanky), com gráficos de tiles creditados a beware. O jogo combina números iguais até formar 2048. A ROM oficial possui 32 KiB, controlador MBC1, 2 KiB de RAM, bateria e compatibilidade com o DMG. O byte de versão do header é 255; ele não é apresentado como uma versão pública do jogo.

- [Fonte e licença em revisão fixa](https://github.com/Sanqui/2048-gb/tree/e44f94f898c1e0de7caa1160c82c0da36ff5eb05).
- [ROM oficial indicada pelo autor](https://sanqui.rustedlogic.net/etc/2048.gb).
- Arquivo incluído: `public/games/2048/2048.gb`.

```text
SHA-256 da ROM:
3ea2376b15b34bd26b10e6b31d2753bf8b086098dbdb5ee84d9c0f03d66d3d7f
```

O site do autor publica o binário sem uma release numerada. A licença e a fonte são fixadas na revisão acima; o arquivo publicado é fixado separadamente pelo hash. Não se afirma equivalência com uma recompilação daquela revisão. A licença Zlib permite redistribuição e permanece intacta em `LICENSE-ZLIB.txt`, junto do README e da atribuição.

| Entrada no Pocket Lab | Ação no jogo                              |
| --------------------- | ----------------------------------------- |
| Enter, Start, Z ou A  | Começa; recomeça quando a partida termina |
| Setas                 | Deslizam as peças nas quatro direções     |
| Shift ou Select       | Permite continuar depois de alcançar 2048 |

## Conferir os arquivos

No PowerShell, a partir da raiz do projeto:

```powershell
Get-FileHash -Algorithm SHA256 public/games/tobu-tobu-girl/tobu.gb
Get-FileHash -Algorithm SHA256 public/games/2048/2048.gb
```

Compare com o manifesto e os hashes acima. Atualizações futuras precisam revisar licença, origem, compatibilidade e hash antes de substituir uma ROM.

Os avisos MIT e Zlib foram copiados integralmente, sem alteração de bytes. Os arquivos originais de licença não contêm U+2013 ou U+2014. O conteúdo do README de cada autor foi preservado, com ajuste de formatação Markdown, como referência da permissão e dos créditos.

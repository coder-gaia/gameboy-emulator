# Créditos e conteúdo de terceiros

## Dependências

- DM Sans: The DM Sans Project Authors. SIL Open Font License 1.1, distribuída no pacote `@fontsource/dm-sans` e em `public/licenses/dm-sans.txt`.
- Space Mono: The Space Mono Project Authors. SIL Open Font License 1.1, distribuída no pacote `@fontsource/space-mono` e em `public/licenses/space-mono.txt`.
- Lucide: ícones sob licença ISC, distribuída no pacote `lucide-react`.
- React e ferramentas de desenvolvimento mantêm suas licenças nos pacotes npm correspondentes e no lockfile.
- pngjs: Luke Page, colaboradores originais e Kuba Niegowski. Licença MIT no pacote `pngjs`; usado somente nos testes para ler a referência PNG e gerar imagens de diagnóstico.
- @noble/hashes: Paul Miller e colaboradores. Licença MIT em `public/licenses/noble-hashes.txt`. Calcula SHA-256 das ROMs de forma portátil, inclusive ao testar no celular por HTTP local.
- fake-indexeddb: licença Apache-2.0 no pacote `fake-indexeddb`, versão 6.2.6. Dependência de desenvolvimento usada somente nos testes de persistência.

## ROMs

Nenhuma ROM comercial ou boot ROM original é distribuída. POCKET TEST e POCKET GARDEN são programas próprios. O jardim, personagem, tiles e letras da legenda também são próprios, sem logos ou assets de terceiros.

A biblioteca da M06 inclui dois jogos homebrew com redistribuição autorizada. Ambos são servidos como arquivos estáticos locais ao site, sem depender de outros servidores para jogar. ROMs, licenças e atribuições ficam em `public/games/`.

| Jogo               | Autoria                                    | Licença                                                       | Conteúdo preservado                                                                      |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Tobu Tobu Girl     | Tangram Games; trilha sonora de potato-tan | MIT para código e CC BY 4.0 para imagens, texto, som e música | ROM oficial inalterada, aviso MIT, declaração de licença dos assets, README e atribuição |
| 2048 para Game Boy | Sanqui; gráficos de tiles por beware       | Zlib                                                          | ROM oficial inalterada, aviso Zlib, README e atribuição                                  |

As permissões foram conferidas nas fontes primárias: [licença de Tobu Tobu Girl](https://github.com/SimonLarsen/tobutobugirl/blob/048a22c2d7ebbe25811322e8692803fa86bb643a/README.md#license) e [licença Zlib de 2048](https://github.com/Sanqui/2048-gb/blob/e44f94f898c1e0de7caa1160c82c0da36ff5eb05/LICENSE). A atribuição CC BY 4.0 preserva o título, os autores, os links de origem e licença e a indicação de que os assets não foram modificados.

Tobu Tobu Girl também incorpora o driver musical mmlgb de Simon Larsen. O [aviso MIT oficial](https://github.com/SimonLarsen/mmlgb/blob/aa0864d4391490057760a2a84dd4ab117f0b04e8/LICENSE) acompanha a ROM em `public/games/tobu-tobu-girl/LICENSE-MMLGB-MIT.txt`; as revisões do submódulo e do aviso estão registradas separadamente no manifesto.

O [manifesto público](../public/games/manifest.json) fixa as revisões, a origem dos binários, os tamanhos e SHA-256. Consulte [jogos demonstrativos](demo-games.md) para controles e reprodução dos downloads. O código do emulador e os jogos têm autoria e licenças próprias.

Blargg e Mooneye são executados com revisões e hashes fixos nas M03 e M04. Os binários Blargg permanecem em `.work` e não são redistribuídos. As 47 fixtures Mooneye preservam a licença MIT em `tests/roms/fixtures/mooneye/LICENSE.txt`.

A M05 executa dmg-acid2 de Matt Currie, versão 1.0, e compara o quadro com o PNG DMG oficial. A ROM e a referência ficam em `tests/roms/fixtures/acid2/`, com a licença MIT em `LICENSE.txt`; não entram no site. Consulte [procedência, hashes, protocolos e reconstrução](test-roms.md).

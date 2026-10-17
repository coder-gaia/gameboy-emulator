# Créditos e conteúdo de terceiros

## Jogos da biblioteca

Nenhuma ROM comercial ou boot ROM original é distribuída. Os jogos abaixo são homebrews autorizados, com binários oficiais inalterados. ROMs, licenças e atribuições permanecem em `public/games/` e na interface.

| Jogo               | Autoria                              | Licença                                             |
| ------------------ | ------------------------------------ | --------------------------------------------------- |
| Tobu Tobu Girl     | Tangram Games; música de potato-tan  | Código MIT; imagens, texto, som e música CC BY 4.0. |
| 2048 para Game Boy | Sanqui; gráficos de tiles por beware | Zlib.                                               |

Fontes: [licenças de Tobu Tobu Girl](https://github.com/SimonLarsen/tobutobugirl/blob/048a22c2d7ebbe25811322e8692803fa86bb643a/README.md#license) e [licença de 2048](https://github.com/Sanqui/2048-gb/blob/e44f94f898c1e0de7caa1160c82c0da36ff5eb05/LICENSE). A atribuição CC BY 4.0 preserva título, autores, origem, licença e indicação de assets inalterados.

Tobu incorpora o driver musical mmlgb de Simon Larsen. O [aviso MIT original](https://github.com/SimonLarsen/mmlgb/blob/aa0864d4391490057760a2a84dd4ab117f0b04e8/LICENSE) acompanha a ROM em `public/games/tobu-tobu-girl/LICENSE-MMLGB-MIT.txt`.

O [manifesto público](../public/games/manifest.json) fixa URLs oficiais, revisões, tamanhos e SHA-256 dos binários. Para reproduzir a obtenção, use `binarySourceUrl` de cada entrada; em Tobu, extraia o caminho `archiveRomPath` do arquivo cujo SHA-256 está registrado. Confira tamanho e hash antes de substituir qualquer arquivo. Não altere binários nem remova seus avisos.

## Dependências

- DM Sans: The DM Sans Project Authors, SIL Open Font License 1.1, preservada em `public/licenses/dm-sans.txt`.
- Space Mono: The Space Mono Project Authors, SIL Open Font License 1.1, preservada em `public/licenses/space-mono.txt`.
- Lucide: ícones ISC, licença no pacote `lucide-react`.
- @noble/hashes: Paul Miller e colaboradores, MIT, aviso em `public/licenses/noble-hashes.txt`.
- pngjs: Luke Page, colaboradores originais e Kuba Niegowski, MIT; usado somente nos testes.
- fake-indexeddb: Apache-2.0, usado somente nos testes de persistência.
- React e React DOM: Meta Platforms, Inc. e afiliados, MIT, aviso original em `public/licenses/react.txt`.
- Ferramentas de desenvolvimento preservam suas licenças nos respectivos pacotes npm. Versões ficam fixadas no lockfile.

## ROMs de teste

Blargg é obtido diretamente da origem somente para testes locais e CI, sem redistribuição. Mooneye preserva o aviso MIT de Joonas Javanainen em `tests/roms/fixtures/mooneye/LICENSE.txt`; dmg-acid2 preserva o aviso MIT de Matt Currie em `tests/roms/fixtures/acid2/LICENSE.txt`. Fixtures não entram no site. Procedência, hashes e reconstrução ficam em [validação técnica](test-roms.md).

## Conteúdo próprio e capturas

POCKET TEST e POCKET GARDEN, incluindo cenário, personagem, tiles e letras, são criações próprias. As licenças dos jogos e dependências não concedem uma licença geral ao código do emulador.

As duas imagens usadas no README mostram o jardim real no Chromium, sem áudio ativo:

- [Desktop](media/pocket-lab-desktop.png): candidata M14 1.0.0-rc.1, viewport 1440 por 1100 e DPR 1, sem edição.
- [GIF](media/pocket-lab-garden.gif): captura da M13, recortada e convertida com FFmpeg para 400 por 585 pixels, 48 quadros em quatro segundos, a 12 fps. A frequência do arquivo não mede desempenho da aplicação.

Capturas de divulgação não comprovam homologação de áudio ou fluidez no Motorola. Publicação em rede social depende do proprietário.

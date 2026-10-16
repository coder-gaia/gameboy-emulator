export interface DemoGame {
  readonly id: string
  readonly title: string
  readonly subtitle: string
  readonly description: string
  readonly romUrl: string
  readonly sha256: string
  readonly controls: readonly string[]
  readonly sourceUrl: string
  readonly author: string
  readonly license: string
  readonly attribution: string
  readonly creditsUrl: string
}

/** Apenas ROMs homebrew com redistribuição autorizada e bytes fixados por SHA-256. */
export const DEMO_GAMES: readonly DemoGame[] = [
  {
    id: 'tobu-tobu-girl',
    title: 'Tobu Tobu Girl',
    subtitle: 'Um salto para salvar seu gato.',
    description:
      'Salte sobre criaturas, use impulsos e voe entre as nuvens antes que o tempo acabe.',
    romUrl: '/games/tobu-tobu-girl/tobu.gb',
    sha256: '5d3871cae77db2287807e8914fd21f76203e73aa3fec20955489d45cb4571d8f',
    controls: [
      'Enter ou Start: começar e pausar.',
      'Setas: mover e escolher a direção do impulso.',
      'Z ou A: dar um impulso na direção escolhida.',
      'X ou B: manter pressionado para voar.',
    ],
    sourceUrl:
      'https://github.com/SimonLarsen/tobutobugirl/tree/048a22c2d7ebbe25811322e8692803fa86bb643a',
    author: 'Tangram Games',
    license: 'MIT para código; CC BY 4.0 para imagens, texto, som e música.',
    attribution:
      'Tobu Tobu Girl por Tangram Games. Trilha sonora por potato-tan. ROM original sem alterações.',
    creditsUrl: '/games/tobu-tobu-girl/ATTRIBUTION.txt',
  },
  {
    id: '2048',
    title: '2048',
    subtitle: 'Quatro direções. Muitas possibilidades.',
    description: 'Deslize as peças, combine números iguais e procure um caminho até 2048.',
    romUrl: '/games/2048/2048.gb',
    sha256: '3ea2376b15b34bd26b10e6b31d2753bf8b086098dbdb5ee84d9c0f03d66d3d7f',
    controls: [
      'Enter, Start, Z ou A: começar; recomeçar após o fim da partida.',
      'Setas: deslizar as peças nas quatro direções.',
      'Shift ou Select: continuar depois de alcançar 2048.',
    ],
    sourceUrl: 'https://github.com/Sanqui/2048-gb/tree/e44f94f898c1e0de7caa1160c82c0da36ff5eb05',
    author: 'Sanqui',
    license: 'Zlib.',
    attribution:
      'Versão para Game Boy por Sanqui. Gráficos de tiles por beware. Inspirado no 2048 de Gabriele Cirulli. ROM original sem alterações.',
    creditsUrl: '/games/2048/ATTRIBUTION.txt',
  },
]

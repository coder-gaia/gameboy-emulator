# Emulador de Game Boy: plano de projeto

Documento de planejamento. Escrito para ser lido no começo de cada fase, e não
uma vez só.

---

## 1. O que é, e para quem

Um emulador de Game Boy (DMG) que roda **no navegador**, com precisão suficiente
para passar as suítes de teste conhecidas e com uma interface que uma pessoa
comum consegue usar sem ler instrução.

Duas audiências, e elas querem coisas diferentes:

**Quem vai jogar** quer abrir um link, ver um jogo rodando em três segundos, e
não pensar em mais nada. Não sabe o que é ROM, não quer configurar tecla, e
provavelmente está no celular.

**Quem vai avaliar tecnicamente** quer ver que a CPU passa o `cpu_instrs` do
Blargg, que o PPU passa o `dmg-acid2`, e que existe uma suíte rodando no CI.

O projeto atende as duas sem misturar: a interface é limpa por padrão e o painel
técnico existe atrás de um atalho.

### O que separa isto de um emulador de fim de semana

A maioria dos emuladores de portfólio para no momento em que o Tetris roda.
Funciona, mas é um brinquedo de quem escreveu: janela SDL, tecla fixa, sem save
state, sem som, e ninguém além do autor abre duas vezes.

O critério de sucesso aqui é outro: **alguém que não te conhece abre o link, joga
dez minutos e volta no dia seguinte.**

---

## 2. A decisão que muda todas as outras: navegador

Roda no navegador, compilado para a web, hospedado como site estático.

Por quê:

- **Distribuição é um link.** Nada para instalar, nada para compilar. É a
  diferença entre alguém experimentar e alguém não experimentar.
- **Funciona no celular**, que é onde a maior parte das pessoas vai abrir.
- **Hospedagem é grátis e não hiberna.** Site estático em Vercel, Netlify ou
  GitHub Pages. Sem servidor, sem banco, sem custo, sem manutenção.
- **Não existe backend.** Nada de auth, Docker, Postgres ou fila. O projeto
  inteiro é um artefato só.

Custo dessa escolha: performance exige atenção, e o acesso a arquivos passa pelo
navegador (o usuário escolhe a ROM, você não lê pasta). Os dois são
administráveis e estão tratados nas seções 9 e 5.

---

## 3. Stack

### Núcleo do emulador: TypeScript

**Recomendação: TypeScript no V1.** Não porque seja a melhor ferramenta possível
para emulação, e sim porque é a que te leva ao Tetris rodando mais rápido, e o
maior risco deste projeto é ele não terminar.

O Game Boy roda a 4.194.304 Hz. São cerca de 70.224 ciclos por quadro, a 59,7
quadros por segundo, ou aproximadamente 4,2 milhões de passos por segundo. Isso é
perfeitamente alcançável em JavaScript com `Uint8Array` e um laço sem alocação.
Emuladores em JS puro fazem isso há mais de uma década.

**Rust compilado para WASM é a alternativa séria**, e vale considerar, com o
gatilho explícito:

- Vale a pena se você quiser aprender Rust como objetivo próprio.
- Vale a pena se, medindo, o TypeScript não fechar 60 quadros por segundo num
  celular de entrada.
- **Não** vale a pena se for para "ficar mais impressionante". O que impressiona
  aqui é passar o Mooneye, não a linguagem.

Se for portar depois, o núcleo já vai estar isolado da interface (seção 6), então
a porta é o núcleo inteiro e nada mais.

### Interface: React + TypeScript + Vite

Você já conhece. O tempo economizado aqui vai para a emulação, que é a parte
interessante.

### Renderização: Canvas 2D no V1, WebGL depois se precisar

`putImageData` num canvas de 160x144, escalado por CSS com
`image-rendering: pixelated`. Simples e suficiente.

WebGL entra só quando você quiser efeito de LCD (seção 5), que é shader e não dá
para fazer bem em Canvas 2D.

### Áudio: Web Audio API com `AudioWorklet`

Detalhe que quase todo emulador iniciante erra e que está explicado na seção 9:
**o áudio dita o tempo, não o `requestAnimationFrame`**.

### Persistência: IndexedDB

Saves de bateria, save states e ROMs recentes. Nada sai da máquina do usuário, o
que também resolve a questão legal.

---

## 4. O hardware, em uma página

Para consulta rápida. A referência de verdade é o **Pan Docs**
(https://gbdev.io/pandocs).

### CPU

Sharp SM83. Parece um Z80 e não é: sem registradores alternativos, sem `IX`/`IY`,
com instruções próprias (`LDH`, `LD (HL+),A`) e flags diferentes em alguns casos.
Não confie em documentação de Z80.

- Registradores de 8 bits: `A F B C D E H L`, pareáveis em `AF BC DE HL`
- `SP` e `PC` de 16 bits
- Flags no registrador `F`, bits 7 a 4: Zero, Subtração, Meio carry, Carry
- 4 ciclos de clock por ciclo de máquina

### Mapa de memória

| Faixa       | O que é                                        |
| ----------- | ---------------------------------------------- |
| `0000-3FFF` | ROM, banco fixo 0                              |
| `4000-7FFF` | ROM, banco trocável                            |
| `8000-9FFF` | VRAM                                           |
| `A000-BFFF` | RAM do cartucho, trocável                      |
| `C000-DFFF` | RAM interna                                    |
| `E000-FDFF` | Echo RAM, espelho de `C000-DDFF`               |
| `FE00-FE9F` | OAM, 40 sprites de 4 bytes                     |
| `FEA0-FEFF` | Área proibida, comportamento estranho de verdade |
| `FF00-FF7F` | Registradores de I/O                           |
| `FF80-FFFE` | HRAM                                           |
| `FFFF`      | Interrupt Enable                               |

### PPU

- Tela de 160x144, quatro tons de cinza
- 154 scanlines de 456 dots, total de 70.224 dots por quadro
- Modo 2 (varredura de OAM, 80 dots), Modo 3 (desenho, 172 a 289 dots),
  Modo 0 (HBlank, o resto), Modo 1 (VBlank, 10 scanlines)
- Máximo de 10 sprites por scanline, e a regra de qual sobra importa
- Tiles de 8x8 com 2 bits por pixel, mapa de fundo de 32x32 tiles

### Timers

- `DIV` (`FF04`) incrementa a 16.384 Hz e zera em qualquer escrita
- `TIMA` (`FF05`), `TMA` (`FF06`), `TAC` (`FF07`)
- `TAC` seleciona 4096, 262144, 65536 ou 16384 Hz

### Interrupções

Vetores em `0x40` (VBlank), `0x48` (STAT), `0x50` (Timer), `0x58` (Serial) e
`0x60` (Joypad). Prioridade nessa ordem.

### APU

Quatro canais: dois de onda quadrada (um com sweep), um de onda programável e um
de ruído. Registradores em `FF10-FF26`, RAM de onda em `FF30-FF3F`.

### Cartuchos

| Tipo    | Onde aparece                                        |
| ------- | --------------------------------------------------- |
| Sem MBC | Tetris, Dr. Mario. 32 KB, o caso mais simples        |
| MBC1    | Super Mario Land, Kirby's Dream Land                 |
| MBC2    | RAM embutida de 512x4 bits                           |
| MBC3    | Pokémon Red/Blue/Gold, com relógio de tempo real     |
| MBC5    | Jogos maiores, principalmente de Game Boy Color      |

---

## 5. Como o usuário usa

Esta seção é requisito, e não enfeite. É o que separa este projeto de um
emulador de fim de semana.

### O primeiro contato

Alguém abre o link sem saber o que é ROM. Precisa estar jogando em três segundos.

**Solução: um jogo homebrew já embutido.** Existem jogos de Game Boy livres e
legais para redistribuir, como o *Tobu Tobu Girl* (licença aberta). A página abre
com ele carregado e jogável. Sem clique, sem upload, sem explicação.

O botão de carregar ROM própria fica visível, mas não é obrigatório.

Isso é a decisão de produto mais importante do projeto. Um emulador que exige que
a pessoa arrume uma ROM antes de ver qualquer coisa perde a maioria dos
visitantes na primeira tela.

### Carregar uma ROM

- Arrastar o arquivo em qualquer lugar da página
- Ou clicar e escolher
- O arquivo **não sai da máquina**, e a página diz isso em uma linha

### Controles

Três formas, todas funcionando ao mesmo tempo:

- **Teclado**, com padrão sensato (setas, `Z`, `X`, `Enter`, `Shift`) e
  remapeável
- **Gamepad**, via Gamepad API, reconhecido ao conectar
- **Toque**, com d-pad e botões desenhados em tela, que aparecem sozinhos no
  celular

O toque não é opcional. Metade das pessoas vai abrir no celular.

### As funções que fazem a diferença

Em ordem de impacto sobre "a pessoa volta amanhã":

1. **Save state.** Salvar e carregar em qualquer ponto. É o que torna um jogo de
   1989 jogável para um adulto com 20 minutos livres. Vários slots, com
   miniatura da tela no momento em que foi salvo.

2. **Save de bateria persistente.** O save do Pokémon precisa sobreviver a fechar
   a aba. Escreve na IndexedDB quando a RAM do cartucho muda.

3. **Rewind.** Segurar uma tecla e o tempo anda para trás. Tecnicamente é um
   buffer circular de save states leves, uns 60 por segundo comprimidos, com
   janela de 10 a 30 segundos. É o recurso que mais provoca reação de quem vê, e
   é honestamente divertido de implementar.

4. **Avanço rápido.** Segurar para acelerar. Diálogo de RPG e tela de espera
   ficam suportáveis.

5. **Pausa que pausa de verdade**, inclusive o áudio.

### O visual

Aqui mora a diferença entre "funciona" e "bonito".

**Escala inteira, sem borrão.** O padrão de todo mundo é esticar 160x144 para
caber na tela e o resultado é uma imagem embaçada. Use múltiplos inteiros (2x,
3x, 4x, 5x) e `image-rendering: pixelated`. A imagem fica nítida como o hardware
original.

**Paletas trocáveis.** Quatro tons, e a escolha muda completamente a sensação:

- **DMG**, o verde original
- **Pocket**, cinza do Game Boy Pocket
- **Light**, o azul do Game Boy Light
- Duas ou três modernas, de alto contraste

Trocar paleta é a personalização mais barata de implementar e a que mais dá
prazer imediato.

**Efeito de LCD, opcional e desligado por padrão.** Grade sutil entre pixels e
um leve fantasma no movimento, imitando o LCD original. É shader em WebGL. Fica
lindo e algumas pessoas odeiam, então é uma opção.

**Moldura de console, opcional.** Desenhar o corpo do Game Boy em volta da tela é
tentador e ocupa espaço. Deixe como opção, com "só a tela" no padrão.

**Boot animation.** O logo da Nintendo descendo com o som característico. O boot
ROM original é protegido por direito autoral, mas existem reimplementações
abertas e compatíveis. Vale muito: é o primeiro sinal de que o emulador é sério.

### O painel técnico

Atrás de um atalho, escondido por padrão. Quando aberto:

- Estado da CPU, registradores e flags
- Desassemblador acompanhando o `PC`
- Visualizador de tiles e de mapas de fundo
- Visualizador de OAM
- Contadores: quadros por segundo, ciclos por quadro, tempo por quadro

Isso serve a você durante o desenvolvimento e serve como prova técnica depois. É
o tipo de coisa que vale um GIF no README.

### Acessibilidade e detalhes que quase todo mundo esquece

- Todas as teclas remapeáveis, inclusive para quem usa uma mão só
- Respeitar `prefers-reduced-motion`, desligando o efeito de fantasma do LCD
- Volume controlável e mudo, com o estado lembrado
- Áudio só começa depois do primeiro toque ou clique, porque o navegador exige
- A página não quebra se WebGL não existir: cai para Canvas 2D
- Lembrar o último jogo, a paleta e o volume na IndexedDB

---

## 6. Arquitetura

A regra que sustenta tudo: **o núcleo não conhece o navegador.**

```
                    interface (React)
                            |
                       [ fronteira ]
                            |
   +------------------------+------------------------+
   |                     núcleo                      |
   |                                                 |
   |   CPU  <->  Bus  <->  PPU                       |
   |             |    <->  APU                       |
   |             |    <->  Timer                     |
   |             |    <->  Joypad                    |
   |             |    <->  Cartridge (MBC)           |
   |                                                 |
   +-------------------------------------------------+
```

O núcleo:

- Não importa nada de DOM, Canvas ou Web Audio
- Recebe a ROM como `Uint8Array`
- Expõe `step()`, `runFrame()`, `framebuffer`, `audioBuffer`, `setButton()`
- Serializa e desserializa o estado inteiro, que é o que dá save state e rewind
  de graça

Isso importa por três motivos: dá para testar o núcleo sem navegador (e portanto
no CI), dá para portar para Rust depois trocando só o núcleo, e impede que
lógica de emulação vaze para dentro de componente React.

### Estrutura de pastas sugerida

```
src/
  core/
    cpu/          instruções, decodificação, interrupções
    ppu/          modos, fetcher, sprites, paletas
    apu/          quatro canais, mixagem
    memory/       bus, mapa de memória, HRAM, WRAM
    cart/         parsing do header, MBC1, MBC2, MBC3, MBC5
    timer/
    joypad/
    gameboy.ts    monta tudo e expõe a API pública
  ui/
    screen/       canvas, escala, paletas, shader de LCD
    controls/     teclado, gamepad, toque
    save/         IndexedDB, save states, rewind
    debug/        painel técnico
  app/            React, rotas, estado da interface
test/
  roms/           ROMs de teste com licença livre
  blargg.spec.ts
  mooneye.spec.ts
```

---

## 7. Fases

Cada fase tem critério de pronto **verificável**, e não opinativo. A ordem foi
escolhida para o primeiro momento visível chegar cedo.

### Fase 0, opcional: CHIP-8 de aquecimento

**Um fim de semana.** 35 instruções, tela de 64x32, sem timing complicado.

Serve para você acertar o laço principal, o desenho no canvas e o mapeamento de
teclado num contexto em que tudo é fácil. Quando chegar no Game Boy, essas três
coisas já estarão resolvidas.

**Pronto quando:** o Pong e o Space Invaders rodam.

Pule se estiver impaciente. Não pule se for a sua primeira emulação.

---

### Fase 1: esqueleto e o cartucho

**Pronto quando:** você carrega uma ROM e a interface mostra o título do jogo, o
tipo de MBC, o tamanho da ROM e da RAM, tudo lido do header em `0100-014F`.

Ainda não roda nada. Mas você já tem carregamento de arquivo, parsing e a
primeira tela.

---

### Fase 2: CPU

A fase mais longa e a mais mecânica. Cerca de 500 opcodes contando os prefixados
por `CB`.

Conselho prático: **não escreva os 500 à mão um a um.** Muitos são famílias
regulares (`LD r,r'` são 63 variações da mesma coisa). Gere o que for regular e
escreva à mão o que for exceção.

**Pronto quando:** as 11 sub-ROMs do `cpu_instrs` do Blargg passam, com o
resultado lido pela porta serial e afirmado em teste automatizado.

Este é o marco que separa "estou tentando" de "isto vai funcionar".

---

### Fase 3: timing e interrupções

`DIV`, `TIMA`, `TMA`, `TAC`, o vetor de interrupções, `HALT` e a famosa
[halt bug](https://gbdev.io/pandocs/halt.html).

**Pronto quando:** `instr_timing` do Blargg passa e os testes de timer do Mooneye
passam.

Não pule para o PPU antes disso. Quase todo bug misterioso de vídeo é, na
verdade, timing errado aqui.

---

### Fase 4: PPU, fundo

Modos, `LY`, `LYC`, `STAT`, VRAM, mapas de fundo, tiles, scroll.

**Pronto quando:** a tela de título do Tetris aparece corretamente.

**Este é o momento do projeto.** Depois de semanas em opcodes, uma imagem
reconhecível surge. Tire print, guarde a data.

---

### Fase 5: sprites, janela e entrada

OAM, prioridade, limite de 10 sprites por linha, flip, a janela, e o registrador
de joypad em `FF00`.

**Pronto quando:** o Tetris é **jogável do começo ao fim**, e o `dmg-acid2`
desenha o rosto correto.

O `dmg-acid2` é ótimo porque o resultado é visual: rosto certo passou, rosto
deformado indica exatamente qual recurso está errado.

---

### Fase 6: MBC1 e save de bateria

Troca de banco de ROM e de RAM, os modos do MBC1, e persistência da RAM do
cartucho na IndexedDB.

**Pronto quando:** Super Mario Land e Kirby's Dream Land rodam, e um save
sobrevive a fechar e reabrir a aba.

---

### Fase 7: save state e rewind

Serialização do estado inteiro do núcleo. É aqui que a decisão de isolar o núcleo
começa a pagar.

**Pronto quando:** salvar, jogar mais, carregar e continuar exatamente de onde
parou. E o rewind anda 20 segundos para trás segurando uma tecla.

Detalhe de implementação: para o rewind, salve o estado a cada quadro num buffer
circular e comprima com delta contra o anterior. Estado cru a 60 por segundo
estoura a memória rápido.

---

### Fase 8: áudio

Os quatro canais, mixagem, e a sincronia (seção 9).

**Pronto quando:** a música do Tetris toca sem estalos por cinco minutos
seguidos.

Áudio é a fase mais frustrante depois da CPU. Estalo quase sempre é sincronia,
não DSP.

---

### Fase 9: a interface de verdade

Tudo da seção 5: paletas, escala inteira, toque, gamepad, avanço rápido,
onboarding com o jogo homebrew, remapeamento, persistência de preferências.

**Pronto quando:** você entrega o link para alguém que não é programador, sem
explicar nada, e a pessoa joga.

Faça esse teste com uma pessoa de verdade. É o único critério que importa aqui.

---

### Fase 10: MBC3 e Pokémon

MBC3 com relógio de tempo real.

**Pronto quando:** Pokémon Red inicia, você salva no jogo, fecha a aba, reabre e
o save está lá.

Pokémon é um marco emocional forte e um teste técnico exigente ao mesmo tempo.

---

### Fase 11: painel técnico e publicação

Desassemblador, visualizador de tiles e de OAM, contadores. Deploy, README com
GIF, e a lista honesta do que não é suportado.

**Pronto quando:** está no ar, num link, e o README mostra a suíte de testes
passando.

---

### Depois, se quiser continuar

Game Boy Color (cores, DMA de HDMA, banco duplo de WRAM), link cable por WebRTC
para jogar dois em rede, e Super Game Boy. Nada disso é necessário para o projeto
estar pronto.

---

## 8. Estratégia de teste

A parte que transforma isto de brinquedo em trabalho de engenharia, e ela é
barata porque **o ecossistema de Game Boy já tem as suítes prontas**.

### As suítes

| Suíte             | O que verifica                            | Como lê o resultado          |
| ----------------- | ----------------------------------------- | ---------------------------- |
| Blargg `cpu_instrs` | Todos os opcodes, em 11 sub-testes      | Saída pela porta serial      |
| Blargg `instr_timing` | Ciclos de cada instrução               | Serial                       |
| Blargg `mem_timing` | Timing de acesso à memória               | Serial                       |
| Blargg `dmg_sound`  | Os quatro canais do APU                  | Serial                       |
| Mooneye Test Suite | Timing exato, casos de borda              | Registradores em padrão conhecido |
| `dmg-acid2`        | Renderização do PPU                       | Imagem: rosto certo ou não   |

Confira a licença de cada uma antes de versionar no repositório. A suíte do
Mooneye é aberta e pode ser compilada do fonte, o que é a rota mais segura. As do
Blargg circulam livremente há décadas mas sem licença formal declarada, então
vale baixá-las em tempo de CI em vez de commitá-las.

### O CI

Esta é a ideia que vale a pena, e quase nenhum emulador de portfólio tem:

**Rodar as ROMs de teste sem cabeça, no GitHub Actions, a cada push.** O núcleo
não depende de navegador, então roda direto no Node. Cada teste do Blargg escreve
o resultado na porta serial; você captura, e afirma que a string é `Passed`.

Para o `dmg-acid2`, rode até o quadro N e compare o hash do framebuffer com o
esperado.

O README ganha um badge que diz algo verificável, e não uma opinião.

### Testes de regressão de quadro

Escolha momentos determinísticos (tela de título de N jogos, quadro 600 com
entrada nenhuma), guarde o hash, e falhe quando mudar. Pega regressão de PPU que
teste unitário nunca pegaria.

O cuidado: se mudar de propósito, o hash muda, e você precisa olhar a imagem
nova antes de aceitar. Guarde um PNG junto do hash.

---

## 9. Os pontos difíceis, nomeados antes

Cada um destes já derrubou muito emulador. Saber que existem é metade da
solução.

### O halt bug

Quando `HALT` executa com interrupções desabilitadas e uma interrupção pendente,
o `PC` não incrementa e o byte seguinte é executado duas vezes. É comportamento
real do hardware, e alguns jogos dependem dele.

### Sincronia de áudio, e não de vídeo

O erro clássico: rodar um quadro por `requestAnimationFrame` e empurrar o áudio
gerado. O monitor roda a 60 Hz e o Game Boy a 59,727 Hz, então a cada poucos
segundos sobra ou falta amostra, e você ouve um estalo.

**O certo é o inverso: o áudio dita o tempo.** Rode a emulação até encher o
buffer de áudio, e desenhe o quadro quando ele ficar pronto. A placa de som é o
relógio mais estável disponível.

### O fetcher de pixels do PPU

Emuladores simples desenham uma scanline inteira de uma vez. Funciona para a
maioria dos jogos e quebra nos que mexem em registradores no meio da linha, que
são justamente os visualmente impressionantes.

Sugestão: comece por scanline na fase 4, e migre para fetcher ciclo a ciclo
quando encontrar o primeiro jogo que quebra. Migrar depois é trabalhoso mas
honesto; tentar o fetcher exato de cara costuma travar o projeto.

### `LYC=LY` e o `STAT` interrupt

Fonte inesgotável de bugs sutis. Vários jogos usam para efeito de split screen, e
o timing de quando a interrupção dispara é específico.

### DMA de OAM

Copia 160 bytes e leva 160 ciclos de máquina, durante os quais a CPU só enxerga
HRAM. Jogos contam com isso e rodam a rotina de cópia a partir da HRAM.

### O `F` só tem 4 bits úteis

Os bits 3 a 0 do registrador `F` são sempre zero. Se `PUSH AF` / `POP AF` não
respeitar isso, testes falham de um jeito difícil de rastrear.

### Echo RAM e a área proibida

`E000-FDFF` espelha a RAM interna. `FEA0-FEFF` tem comportamento estranho de
verdade no hardware. Alguns testes verificam os dois.

### Performance em celular

Meça cedo, num celular de entrada, e não só no seu desktop. Sinais de alerta:
alocação dentro do laço de emulação, objetos em vez de `Uint8Array`, e uso de
`Map` no caminho quente.

Regras práticas: memória em `Uint8Array`, framebuffer em `Uint8ClampedArray`,
despacho de opcode por tabela de funções ou `switch` grande (as duas são rápidas
em V8; meça antes de brigar), e zero alocação por quadro.

---

## 10. O que não fazer

O anti-escopo é o que te faz terminar.

- **Não faça backend.** Nenhum. Sem contas, sem nuvem, sem sincronia de save.
  Tudo local, e essa é uma decisão de produto, não uma limitação.
- **Não faça biblioteca de jogos com capas.** Metadados de jogo são um poço, e
  imagem de capa é problema de direito autoral.
- **Não distribua ROM comercial.** Nem uma. Só homebrew com licença clara.
- **Não comece pelo Game Boy Color.** Duplica o trabalho do PPU antes de o DMG
  estar sólido.
- **Não persiga precisão de subciclo no V1.** É um objetivo de anos, e é o tipo
  de coisa que faz o projeto nunca ficar pronto.
- **Não escreva ADR.** Um comentário no arquivo quando a decisão for
  contraintuitiva basta. Este projeto é para ser divertido.
- **Não emule o link cable no V1.** É tentador e é um projeto inteiro por si só.

---

## 11. Questão legal, em três linhas

O emulador é legal. ROM comercial é protegida por direito autoral e você não pode
distribuir. O usuário traz a dele, e o arquivo nunca sai da máquina dele.

O boot ROM original também é protegido, mas existem reimplementações abertas e
compatíveis, que você pode usar para ter a animação de abertura.

Deixe isso escrito na página, em uma linha. Passa seriedade e evita conversa
chata.

---

## 12. Referências

**Essenciais:**

- **Pan Docs**: https://gbdev.io/pandocs. A referência. Leia o mapa de memória e
  o capítulo do PPU antes de começar.
- **Game Boy: Complete Technical Reference**, do gekkio. Timing em nível de
  ciclo, quando o Pan Docs não bastar.
- **awesome-gbdev**: https://github.com/gbdev/awesome-gbdev. Índice de tudo.
- **Tabela de opcodes**: https://izik1.github.io/gbops. Melhor do que a tabela
  clássica, e corrigida.

**Suítes de teste:**

- Blargg's test roms
- Mooneye Test Suite: https://github.com/Gekkio/mooneye-test-suite
- dmg-acid2: https://github.com/mattcurrie/dmg-acid2

**Para o CHIP-8, se fizer a fase 0:**

- Guia do Tobias V. Langhoff, "Guide to making a CHIP-8 emulator"

**Homebrew para embutir:**

- Tobu Tobu Girl (licença aberta)
- gbdev.io/games tem uma lista, com licenças

---

## 13. Cronograma realista

Contando noites e fins de semana, sem pressa:

| Fase                        | Estimativa    |
| --------------------------- | ------------- |
| 0. CHIP-8 (opcional)        | 1 fim de semana |
| 1. Esqueleto e cartucho     | 2 a 3 noites  |
| 2. CPU                      | 1 a 2 semanas |
| 3. Timing e interrupções    | 3 a 5 noites  |
| 4. PPU, fundo               | 1 semana      |
| 5. Sprites, janela, entrada | 4 a 6 noites  |
| 6. MBC1 e save              | 2 a 3 noites  |
| 7. Save state e rewind      | 3 a 4 noites  |
| 8. Áudio                    | 1 a 1,5 semana |
| 9. Interface                | 1 semana      |
| 10. MBC3 e Pokémon          | 2 a 3 noites  |
| 11. Painel e publicação     | 3 a 4 noites  |

**Total: sete a nove semanas** para tudo. Mas o Tetris jogável chega na fase 5,
por volta da terceira ou quarta semana, e daí em diante cada fase entrega algo
que você quer mostrar.

Se der para publicar antes: **as fases 1 a 6 mais um pedaço da 9 já são um
projeto publicável.** Áudio, rewind e Pokémon são melhorias, e não requisitos.

---

## 14. O critério final

O projeto está pronto quando você manda o link para alguém que não programa, sem
nenhuma explicação, e a pessoa joga por dez minutos.

Tudo neste documento existe para chegar nesse momento.

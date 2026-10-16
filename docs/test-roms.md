# ROMs externas de teste

O manifesto em `tests/roms/manifest.json` fixa a origem, a revisão, o SHA-256, o protocolo de resultado e as dependências dos testes de instruções e timing. `tests/roms/mbc1-manifest.json` registra os testes do mapper MBC1, `tests/roms/audio-manifest.json` registra `dmg_sound` e `tests/roms/acid2-manifest.json` registra a validação gráfica. A seleção representa o Game Boy DMG com revisão de CPU A, B ou C. Não inclui expectativas exclusivas de DMG 0, MGB, SGB ou CGB.

Os binários de teste não entram no site e não são jogos disponíveis ao visitante. O projeto não inclui ROM comercial nem boot ROM original.

## Preparação

Na raiz do projeto, com Node 22.12 ou superior:

```powershell
node scripts/test-roms/fetch.mjs --acid2 --mbc1 --audio
```

O comando baixa somente os 27 arquivos Blargg necessários, de URLs fixadas por revisão, para `.work/roms/blargg/`: 15 de CPU e timing, mais 12 `dmg_sound`. Essa pasta é ignorada pelo Git. As 59 fixtures Mooneye são distribuídas com a licença MIT original em `tests/roms/fixtures/mooneye/LICENSE.txt`: 47 de CPU, periféricos e timing, mais 12 de MBC1. A ROM e a referência dmg-acid2 também são fixtures versionadas, com licença MIT em `tests/roms/fixtures/acid2/LICENSE.txt`.

Todo arquivo existente e todo download precisa coincidir com o SHA-256 registrado. Um arquivo divergente causa falha e não é substituído silenciosamente. A opção `--verify` executa apenas a conferência, sem acesso à rede:

```powershell
node scripts/test-roms/fetch.mjs --verify --acid2 --mbc1 --audio
```

O CI pode executar os mesmos comandos antes do runner de hardware. Os testes devem falhar se um arquivo estiver ausente, corrompido ou se a execução atingir o limite de T-cycles.

O comando completo da M07 verifica todos os manifestos e executa os 87 testes externos:

```powershell
npm.cmd run test:hardware
```

O resultado atual é 62 ROMs de instruções e timing aprovadas, dmg-acid2 aprovado com zero pixels divergentes, 12 ROMs MBC1 aprovadas e 12 ROMs `dmg_sound` aprovadas. Os testes locais de unidade e integração são executados separadamente por `npm.cmd test`.

## Licenças e procedência

| Suíte     | Origem fixada                                                                                                                                       | Licença e distribuição                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blargg    | [retrio/gb-test-roms, c240dd7](https://github.com/retrio/gb-test-roms/tree/c240dd7d700e5c0b00a7bbba52b53e4ee67b5f15)                                | A revisão não contém licença explícita. Os binários são obtidos diretamente da origem para uso nos testes locais e no CI. Não são incorporados ao repositório, aos artefatos públicos ou ao site. |
| Mooneye   | [Gekkio/mooneye-test-suite, 31510e1](https://github.com/Gekkio/mooneye-test-suite/tree/31510e12eea6286d36eea060a6adde755e1067aa)                    | [MIT](https://github.com/Gekkio/mooneye-test-suite/blob/31510e12eea6286d36eea060a6adde755e1067aa/LICENSE). As fixtures preservam o aviso original de Joonas Javanainen.                           |
| dmg-acid2 | [mattcurrie/dmg-acid2, 8a98ce7](https://github.com/mattcurrie/dmg-acid2/tree/8a98ce731f96dde032ffb22ec36dc985d78fdb18), ROM publicada na versão 1.0 | [MIT](https://github.com/mattcurrie/dmg-acid2/blob/8a98ce731f96dde032ffb22ec36dc985d78fdb18/LICENSE). A ROM e a referência preservam o aviso original de Matt Currie. Executado na M05.           |

O repositório retrio identifica Shay Green como autor das ROMs Blargg e aponta para o antigo endereço oficial. A disponibilidade pública desses arquivos não é tratada como concessão de licença para redistribuição. Downloads não devem ser anexados a releases nem enviados como artefatos do CI.

## Seleção e protocolos

### Blargg

As 11 ROMs individuais de `cpu_instrs`, `instr_timing` e as três individuais de `mem_timing` usam o protocolo `blargg-serial`. O runner observa as transferências do link, registra o texto de diagnóstico e só considera sucesso a mensagem final `Passed`. A mensagem `Failed` representa falha. As ROMs combinadas ficam fora da seleção.

Os readmes de [cpu_instrs](https://github.com/retrio/gb-test-roms/blob/c240dd7d700e5c0b00a7bbba52b53e4ee67b5f15/cpu_instrs/readme.txt), [instr_timing](https://github.com/retrio/gb-test-roms/blob/c240dd7d700e5c0b00a7bbba52b53e4ee67b5f15/instr_timing/readme.txt) e [mem_timing](https://github.com/retrio/gb-test-roms/blob/c240dd7d700e5c0b00a7bbba52b53e4ee67b5f15/mem_timing/readme.txt) documentam a saída serial e o timeout das esperas pelo LCD. Não é necessário falsificar LY para esses testes. O runner mantém o mesmo bus usado pelo núcleo.

Esses 15 binários declaram MBC1, embora tenham somente dois bancos e nenhuma RAM. Desde a M06, `tests/helpers/test-cartridge.ts` cria o cartucho pela factory real do produto. Os testes usam o mesmo MBC1, bus e CPU da aplicação, sem alterar header ou hash. O adapter provisório de dois bancos foi removido.

`instr_timing` verifica duração total de instruções, incluindo os dois caminhos dos saltos condicionais. `mem_timing` verifica quando ocorre o acesso à memória dentro da instrução. Aprovar somente a primeira suíte não comprova a segunda.

### Blargg dmg_sound

`tests/roms/audio-manifest.json` fixa os 12 arquivos individuais em `dmg_sound/rom_singles/`, na mesma revisão Blargg dos testes de CPU. Os downloads ficam somente em `.work/roms/blargg/dmg_sound/rom_singles/`, sem redistribuição no repositório, site ou artefatos do CI.

O protocolo `blargg-memory` segue o [readme original](https://github.com/retrio/gb-test-roms/blob/c240dd7d700e5c0b00a7bbba52b53e4ee67b5f15/dmg_sound/readme.txt): assinatura `DE B0 61` em A001 a A003, status `80` em A000 durante execução, status `00` no sucesso e texto terminado em zero a partir de A004. Uma falha inclui esse texto no diagnóstico. O runner não interpreta ausência de áudio audível como falha de hardware.

Os 12 casos verificam máscaras de registradores, length, efeitos de trigger, sweep, overflow, sincronização com DIV, preservação de length durante power cycle e acesso, escrita e corrupção de wave RAM no DMG. A execução usa a APU, o bus e a factory de cartucho do produto, sem modificar as ROMs ou injetar resultados.

A suite comprova comportamentos observáveis pela CPU. Ela não compara gravações, resposta analógica, latência ou fidelidade acústica com um aparelho físico. A geração de PCM, o mixer e a fila do AudioWorklet têm testes próprios. Consulte [arquitetura de áudio e limites](audio-runtime.md).

### Mooneye

O protocolo `mooneye-registers` detecta a instrução `LD B,B` com os seis registradores no estado definido pela suíte:

- Sucesso: B=3, C=5, D=8, E=13, H=21, L=34.
- Falha: B=C=D=E=H=L=0x42.

Uma ocorrência de `LD B,B` com outros valores não encerra o teste. O protocolo oficial também transmite os valores pela serial, mas observar os registradores permite obter o resultado antes dessa transmissão. [Protocolo oficial Mooneye](https://github.com/Gekkio/mooneye-test-suite/blob/31510e12eea6286d36eea060a6adde755e1067aa/README.markdown#passfail-reporting).

A seleção da M03 contém 27 ROMs: os 13 testes de timer, DIV, EI, sequência EI/DI, RETI, timing de interrupção, IF/IE, prioridade durante escrita na pilha, HALT com interrupção de timer, POP, DAA, registrador F e DMA básico e leitura do registrador DMA.

As outras 20 entradas ficam na M04 porque esperam LY/VBlank real durante o teste. Elas exercitam acessos de instruções e DMA sincronizados com o LCD. O runner seleciona a milestone pelo campo `milestone`; não simula LY nem injeta resultados para antecipar a execução.

Os casos de instruções que atravessam WRAM e OAM durante DMA também verificam a separação dos barramentos do DMG. Uma cópia de VRAM ocupa seu próprio barramento e permite acesso à memória principal; uma cópia da memória principal permite acesso à VRAM quando a PPU a libera. O bloqueio acompanha a origem ativa durante reinícios do DMA. Essa modelagem foi conferida com os testes Mooneye verificados em hardware e a seleção de barramento em `is_addr_in_dma_use` do [SameBoy](https://github.com/LIJI32/SameBoy/blob/master/Core/memory.c).

O teste `oam_dma/sources-GS` não integra este grupo: seu cartucho é MBC5 com RAM e bateria. Ele pode ser incluído na M12, quando o mapper correspondente existir. Os testes de boot ficam fora da seleção porque o projeto inicializa após o boot e não distribui boot ROM.

### Mooneye MBC1

O manifesto `tests/roms/mbc1-manifest.json` usa a mesma revisão Mooneye e o mesmo compilador das outras fixtures. As 12 ROMs em `tests/roms/fixtures/mooneye/emulator-only/mbc1/` exercitam os registros `bits_bank1`, `bits_bank2`, `bits_mode` e `bits_ramg`, os tamanhos RAM `ram_64kb` e `ram_256kb` e os tamanhos ROM `rom_512kb`, `rom_1Mb`, `rom_2Mb`, `rom_4Mb`, `rom_8Mb` e `rom_16Mb`. Os nomes upstream usam bits: 16 Mbit equivalem a 2 MiB de ROM.

O runner `tests/hardware/mbc1.test.ts` verifica cada hash e executa as ROMs com `createCartridge`, usando o protocolo de registradores Mooneye. Os resultados esperados foram [verificados pelo autor em cartucho com chip MBC1B1](https://github.com/Gekkio/mooneye-test-suite/tree/31510e12eea6286d36eea060a6adde755e1067aa/emulator-only/mbc1). Todos os 12 casos selecionados foram aprovados no núcleo do projeto.

O mapper implementa MBC1 padrão: ROM em potência de dois até 2 MiB, RAM até 32 KiB para ROM até 512 KiB e RAM até 8 KiB para ROM de 1 MiB ou 2 MiB. Os bits de banco sem linhas físicas são mascarados depois da tradução do registro primário zero para um. A convenção homebrew de RAM de 2 KiB usa espelhamento e gera aviso no header.

`multicart_rom_8Mb` exige MBC1M, com outra ligação dos bits de banco. Esse perfil fica fora do escopo atual e não é implementado nem autodetectado. A ROM não integra o manifesto de MBC1 padrão. Configurações incompatíveis com a fiação padrão, como ROM de 1 MiB com 32 KiB de RAM, são rejeitadas pela factory.

### dmg-acid2

`tests/roms/acid2-manifest.json` separa a validação gráfica da M05. A ROM é o [binário oficial 1.0](https://github.com/mattcurrie/dmg-acid2/releases/download/v1.0/dmg-acid2.gb). A referência é o [PNG DMG oficial](https://github.com/mattcurrie/dmg-acid2/blob/8a98ce731f96dde032ffb22ec36dc985d78fdb18/img/reference-dmg.png), com 160 por 144 pixels.

O protocolo `framebuffer` compara todos os pixels antes da paleta visual, de filtros e da escala da interface. Os quatro níveis de cinza, do mais claro para o mais escuro, são 255, 170, 85 e 0. A referência original é PNG de cinza com profundidade de 2 bits. Uma comparação incorreta deve produzir diagnóstico e imagem de diferenças, preservando a referência original.

O teste usa a mesma classe `GameBoy` da aplicação e captura o décimo quadro. Na M05, todos os 23.040 pixels coincidem. Se houver divergência, os arquivos `dmg-acid2-actual.png`, `dmg-acid2-differences.png` e `dmg-acid2-reference.png` são gravados em `test-results/hardware/`, pasta ignorada pelo Git.

```powershell
node scripts/test-roms/fetch.mjs --verify --acid2
```

Esse teste valida composição de fundo, janela, sprites e interrupções LYC utilizadas pela ROM. O próprio autor informa que um renderizador por scanline consegue passar. A aprovação não comprova precisão de todos os timings do PPU. [Requisitos oficiais](https://github.com/mattcurrie/dmg-acid2#emulator-requirements).

O núcleo atual não implementa pixel FIFO, mudanças de registradores dentro do modo 3 nem as peculiaridades da janela em WX 0 e 166. Esses limites continuam explícitos mesmo com a aprovação da suíte gráfica.

## Reconstruir Mooneye

As fixtures foram compiladas sem modificar as fontes, com WLA-DX 10.6. A revisão do compilador é `89a90a56be5c2b8cf19a9afa3e1b32384ddb1a97`, a mesma fixada pelo [workflow upstream](https://github.com/Gekkio/mooneye-test-suite/blob/31510e12eea6286d36eea060a6adde755e1067aa/.github/workflows/ci.yml).

O script de reconstrução valida a revisão e a ausência de alterações nas fontes. Ele monta as ROMs em `.work/roms/mooneye-built/` e exige que os SHA-256 sejam idênticos às fixtures. Não altera as fixtures versionadas.

### Windows

Baixe o [arquivo oficial WLA-DX 10.6 Win64](https://github.com/vhelin/wla-dx/releases/download/v10.6/wla_dx_v10.6_Win64.zip) para `.work/roms/tooling/`. Antes de extrair, confirme o SHA-256:

```text
cbb3f8878f8028e6c2fb5cccd79dc9746518ee99def533c8e0b77cbd46a66091
```

Com o arquivo extraído em `.work/roms/tooling/wla-dx-10.6/`:

```powershell
git clone https://github.com/Gekkio/mooneye-test-suite.git .work/roms/mooneye-source
git -C .work/roms/mooneye-source checkout 31510e12eea6286d36eea060a6adde755e1067aa
node scripts/test-roms/build-mooneye.mjs .work/roms/mooneye-source .work/roms/tooling/wla-dx-10.6/wla_dx_v10.6_Win64/wla-gb.exe .work/roms/tooling/wla-dx-10.6/wla_dx_v10.6_Win64/wlalink.exe
```

### Linux e CI

São necessários Git, CMake, um compilador C e Make. Não é necessário Docker nem RGBDS para Mooneye.

```sh
mkdir -p .work/roms
git clone https://github.com/Gekkio/mooneye-test-suite.git .work/roms/mooneye-source
git -C .work/roms/mooneye-source checkout 31510e12eea6286d36eea060a6adde755e1067aa
git clone https://github.com/vhelin/wla-dx.git .work/roms/wla-source
git -C .work/roms/wla-source checkout 89a90a56be5c2b8cf19a9afa3e1b32384ddb1a97
cmake -S .work/roms/wla-source -B .work/roms/wla-build
cmake --build .work/roms/wla-build --target wla-gb wlalink --parallel 2
node scripts/test-roms/build-mooneye.mjs .work/roms/mooneye-source .work/roms/wla-build/binaries/wla-gb .work/roms/wla-build/binaries/wlalink
```

A reconstrução no Linux está documentada a partir do processo upstream. A conferência efetivamente executada foi Windows, reconstruindo todas as 59 fixtures selecionadas com igualdade de SHA-256. O script inclui os dois manifestos Mooneye, e o runner do projeto registra separadamente o resultado de cada ROM no emulador.

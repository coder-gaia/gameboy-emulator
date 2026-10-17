# Validação técnica

## Comandos

Com Node 22.12 ou superior e dependências instaladas:

```powershell
npm.cmd run check
npm.cmd run test:hardware
npm.cmd run test:e2e
npm.cmd run test:production
npm.cmd run test:audio-flow
```

`check` verifica regras, formatação, lint, testes locais, tipos e build. Hardware executa o núcleo sem navegador; Playwright cobre interface, acessibilidade, produção sob CSP e transporte PCM. Antes do primeiro teste de navegador, execute `npx.cmd playwright install chromium`.

Roteiros manuais são enviados no chat. O [acompanhamento](milestones.md) registra o aceite atual; logs de CI e histórico Git preservam resultados anteriores.

## Procedência das ROMs

As ROMs de teste não entram no site. Os manifestos em `tests/roms/` fixam origem, revisão, SHA-256, protocolo e limite de T-cycles. O runner usa a CPU, o bus e os cartuchos reais do produto, sem alterar ROMs ou injetar resultados.

| Suíte     | Fonte fixada                                                                                                                        | Distribuição e validação                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blargg    | [retrio/gb-test-roms, c240dd7](https://github.com/retrio/gb-test-roms/tree/c240dd7d700e5c0b00a7bbba52b53e4ee67b5f15)                | 27 arquivos baixados somente em `.work`: 15 de CPU/timing e 12 `dmg_sound`. A revisão não contém licença explícita; não redistribuir em site, releases ou artefatos. |
| Mooneye   | [Gekkio/mooneye-test-suite, 31510e1](https://github.com/Gekkio/mooneye-test-suite/tree/31510e12eea6286d36eea060a6adde755e1067aa)    | 75 fixtures com aviso MIT em `tests/roms/fixtures/mooneye/LICENSE.txt`: 47 de CPU/periféricos, 12 MBC1 e 16 MBC2/MBC5/DMA.                                           |
| dmg-acid2 | [mattcurrie/dmg-acid2, 8a98ce7](https://github.com/mattcurrie/dmg-acid2/tree/8a98ce731f96dde032ffb22ec36dc985d78fdb18), binário 1.0 | ROM, PNG DMG de referência e aviso MIT em `tests/roms/fixtures/acid2/`.                                                                                              |

Os cinco manifestos são `manifest.json`, `mbc1-manifest.json`, `mbc-extended-manifest.json`, `audio-manifest.json` e `acid2-manifest.json`. O total é 103 casos. MBC3 e RTC possuem testes próprios; não há ROM externa de RTC executada nesse conjunto.

`npm.cmd run test:hardware` prepara os arquivos automaticamente. Para conferir todos os hashes sem rede:

```powershell
node scripts/test-roms/fetch.mjs --verify --acid2 --mbc1 --audio --mbc-extended
```

Arquivo ausente, hash divergente, falha de protocolo ou timeout causam falha. Downloads divergentes não são substituídos silenciosamente.

## Critérios dos runners

- Blargg CPU/timing: resultado final `Passed` na serial; `Failed` reprova.
- Blargg áudio: assinatura `DE B0 61` em A001 a A003, status em A000 e diagnóstico a partir de A004. Status 00 aprova; 80 indica execução.
- Mooneye: instrução `LD B,B` com B/C/D/E/H/L iguais a 3/5/8/13/21/34 aprova; seis valores 0x42 reprovam.
- dmg-acid2: comparação dos 23.040 pixels do décimo quadro com o PNG oficial, antes de filtros e escala. Diferenças geram imagens em `test-results/hardware/`.

A seleção usa perfil DMG A/B/C com inicialização pós boot. Não simula boot ROM ou LY para antecipar resultados. Aprovar dmg-acid2 não comprova todos os timings da PPU; `dmg_sound` verifica comportamento observável pela CPU, sem comparar equivalência acústica.

## Reconstruir Mooneye

As 75 fixtures usam as fontes originais e WLA-DX 10.6, revisão `89a90a56be5c2b8cf19a9afa3e1b32384ddb1a97`. Com Git, CMake e compilador C:

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

No Windows, use os executáveis `wla-gb.exe` e `wlalink.exe`. O [arquivo oficial Win64 10.6](https://github.com/vhelin/wla-dx/releases/download/v10.6/wla_dx_v10.6_Win64.zip) tem SHA-256 `cbb3f8878f8028e6c2fb5cccd79dc9746518ee99def533c8e0b77cbd46a66091`. O script recebe fonte, assembler e linker como argumentos; rejeita revisão incorreta e fontes modificadas, compila em `.work/roms/mooneye-built/` e exige hashes idênticos. A reconstrução foi efetivamente conferida no Windows; os comandos Linux seguem o processo upstream.

## Desempenho e aparelho real

`benchmark:core`, `benchmark:browser` e `benchmark:rewind` reproduzem medições. Core e rewind imprimem JSON no terminal e só salvam um arquivo quando recebem um caminho por argumento. Use `.work` ou `test-results` para relatórios gerados, sem versionar dados brutos em `docs`. Registre versão, ambiente e condições ao comparar resultados.

No painel **Desempenho e áudio**, uma janela de 60 segundos separa velocidade emulada, imagens desenhadas, fila PCM, RTT e frames ausentes ou descartados. A velocidade usa T-cycles por tempo real, com 4.194.304 T-cycles/s como 100%. O JSON exportado não contém ROM, memória ou progresso. Pausa, rewind e mudança de geração interrompem a janela.

As regressões incluem mensagens agrupadas em 128 ms, saída sintética atrasada em 312 ms, falta real de PCM e recuperação. O teste integrado observa as amostras efetivamente consumidas pelo Worklet, a produção em tempo real, os inventários limitados e o cursor audível. A apresentação usa os quadros atuais, sem esperar esse cursor. A suíte no navegador mantém PCM e Worker reais, com transporte atrasado em 10 ou 60 ms por sentido. Os intervalos também são comparados às capturas programadas pela ROM, preservando transições legítimas de LCD desligado sem aceitar congelamentos com imagens disponíveis. São cenários controlados, não gravações do Motorola.

Os casos de entrada até pixel usam o jardim original, com toque nativo e áudio real ativo. Registram pointerdown, envio ao Worker, mudança de pixels no framebuffer recebido e a mesma mudança no ImageData enviado ao Canvas. Comparam pressões silenciosas com áudio nativo e transporte atrasado, em fases diferentes do abastecimento. O relógio sonoro artificialmente atrasado não aumenta o limite permitido à resposta visual. Esses timestamps medem o caminho de software, não a emissão física de luz nem a latência de alto-falante.

Viewport Pixel 7 e atraso sintético de mensagens cobrem regressão de layout e protocolo no computador. Não equivalem ao Motorola físico; o throttle da página não desacelerou o Worker no experimento registrado. Homologar exige comparar antes e depois de ativar som no aparelho, com música contínua, cadência estável e resposta dos controles. Silenciar mantém o caminho de áudio ativo; recarregue antes da comparação sem áudio.

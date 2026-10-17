# Captura de hardware e desassemblador

O núcleo oferece uma inspeção explícita em `src/core/debug`. Os dados são produzidos somente quando o adaptador chama `captureHardwareDebug(device, memoryStart)`. A captura não executa instruções, não avança T-cycles e não escreve em memória ou registradores. CPU, timer, DMA, PPU, APU, serial, RAM de bateria e RTC conservam o estado observado.

## Contrato da captura

| Campo                                | Conteúdo                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `cpu`                                | Snapshot da CPU na fronteira de instrução, incluindo IME, HALT, STOP e halt bug |
| `disassembly`                        | Doze instruções consecutivas a partir do PC                                     |
| `vram`                               | Cópia dos 6 KiB de tiles em 0x8000 a 0x97FF, total de 384 tiles de 16 bytes     |
| `oam`                                | Cópia dos 160 bytes das 40 entradas de OAM                                      |
| `memory`                             | Endereço inicial e cópia de uma página de 256 bytes                             |
| `ppu`                                | Registradores e contadores fornecidos por `Ppu.snapshot()`                      |
| `timer`                              | Estado de DIV, TIMA, TMA, TAC e fases de reload                                 |
| `dma`                                | Origem, origem pendente, latência, byte parcial e índice da transferência       |
| `interruptEnable` e `interruptFlags` | Leituras de IE e IF; IF inclui os bits altos que retornam 1 no hardware         |
| `cartridge`                          | Mapper, título, tamanhos, presença de RTC e cópia do relógio vivo               |
| `frameId` e `tCycles`                | Quadro atual e total de T-cycles do barramento                                  |

`memoryStart` tem valor padrão 0xC000. Ele precisa ser um inteiro de 0 a 0xFF00, alinhado em 256 bytes. A validação ocorre antes da captura. A última página inclui IE no endereço 0xFFFF.

Leituras do dump, desassemblador, IE e IF usam `MemoryBus.read8Direct`, que não aplica bloqueios da CPU durante DMA ou nos modos de acesso restrito do LCD. Tiles e OAM são cópias dos buffers brutos da PPU. O painel, portanto, mostra o conteúdo interno mesmo quando a CPU receberia 0xFF. A captura não simula uma tentativa de acesso da CPU.

Todos os arrays retornados são cópias. CPU, PPU, timer, DMA e RTC também retornam objetos independentes. Alterar a captura na camada de apresentação não altera a máquina. A saída serial não é drenada e a fila PCM não é consumida.

## Desassemblador SM83

`disassembleInstruction(readByte, address)` decodifica uma instrução. `disassemble(readByte, address, count)` percorre a memória linearmente, com doze linhas por padrão e limite explícito de 256. Cada linha contém:

```ts
interface DisassembledInstruction {
  readonly address: number
  readonly bytes: Uint8Array
  readonly mnemonic: string
  readonly length: number
  readonly valid: boolean
}
```

O endereço inicial precisa estar entre 0 e 0xFFFF. Imediatos e a próxima instrução fazem wrap em 16 bits. Apenas os bytes pertencentes à instrução são lidos. Saltos e chamadas são apresentados, mas não seguidos. O estado de IME, condições, HALT e halt bug não muda a interpretação estática dos bytes.

O desassemblador cobre as instruções base e os 256 opcodes com prefixo CB. Os onze opcodes inválidos são apresentados como `INVÁLIDO $D3`, por exemplo, com `valid: false` e comprimento de um byte. Eles não são executados nem substituídos por NOP.

Os mnemônicos são escritos em maiúsculas. Literais usam `$34` e `$1234`, e parênteses indicam memória. Operações de ALU mostram A explicitamente, como `SUB A, (HL)`. `LDH ($FF34), A` expande o endereço alto do imediato. `LDH (C), A` continua representando o endereço 0xFF00 mais C.

JR mostra o endereço de destino, calculado a partir do PC após seus dois bytes. Os offsets de SP usam sinal e valor decimal: `ADD SP, -128` e `LD HL, SP+127`. Words são lidos em little-endian. STOP é apresentado com seus dois bytes, incluindo o byte seguinte; essa visualização não pretende reproduzir as peculiaridades elétricas de STOP com padding diferente de zero.

## Validação

Os testes próprios verificam os comprimentos e a validade de todos os 256 opcodes base, os mnemônicos dos 256 opcodes CB, famílias de operandos, endereços relativos, offsets assinados, STOP e wrap. A integração compara o estado completo antes e depois da captura, incluindo DMA parcial, modo 3 do LCD, reload parcial do timer, saída serial pendente, PCM e RTC.

Essa inspeção não é um save state, um mecanismo de breakpoint ou um editor de memória. Ela fornece dados para o painel técnico, sem acrescentar trabalho ao caminho de execução quando não é solicitada.

## Referências primárias

- [Pan Docs: codificação das instruções SM83](https://gbdev.io/pandocs/CPU_Instruction_Set.html), com [fonte consultada](https://github.com/gbdev/pandocs/blob/master/src/CPU_Instruction_Set.md).
- [gb-opcodes: tabela de opcodes e operandos](https://github.com/gbdev/gb-opcodes/blob/master/Opcodes.json).
- [RGBDS: referência gbz80](https://rgbds.gbdev.io/docs/gbz80.7).

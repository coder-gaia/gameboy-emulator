# Controladores de cartucho e RTC

O núcleo executa ROM Only, MBC1, MBC2, MBC3 e MBC5 no perfil DMG. ROMs que exigem Game Boy Color continuam recusadas. A validação confere tamanho real, cabeçalho, limites do controlador e presença de RAM declarada.

| Controlador     | ROM máxima | RAM máxima           | Comportamento                                                           |
| --------------- | ---------- | -------------------- | ----------------------------------------------------------------------- |
| ROM Only        | 32 KiB     | 8 KiB                | Sem registradores de bancos                                             |
| MBC1            | 2 MiB      | 32 KiB               | Fiação padrão; ROM de 1 MiB ou mais usa até 8 KiB de RAM                |
| MBC2            | 256 KiB    | 512 nibbles internos | A8 seleciona enable ou banco; RAM espelhada a cada 512 endereços        |
| MBC3            | 2 MiB      | 32 KiB               | RTC apenas nos tipos 0x0F e 0x10; MBC30 não é suportado                 |
| MBC5            | 8 MiB      | 128 KiB              | Banco ROM zero permitido; registradores independentes para os nove bits |
| MBC5 com rumble | 8 MiB      | 64 KiB               | Bit 3 controla o motor lógico; sem vibração física                      |

As ROMs aceitas para MBC1, MBC2, MBC3 e MBC5 têm tamanho em potência de dois. Os códigos históricos de 72, 80 e 96 bancos são reconhecidos no cabeçalho, mas não aceitos para execução. O controlador também recusa RAM em tipos que não possuem esse hardware.

## Arquivos de bateria

O formato de RAM permanece bruto, sem cabeçalho adicional. Os cartuchos anteriores mantêm o mesmo tamanho de arquivo. MBC2 usa 512 bytes com um nibble útil por byte. Na leitura da RAM, os quatro bits superiores retornam 1. A importação aceita bits altos preenchidos e conserva apenas os quatro bits inferiores.

O tamanho `metadata.ramSize` representa os bytes necessários para persistência. Por isso MBC2 informa 512, mesmo com o código de RAM zero no cabeçalho, pois a memória faz parte do próprio controlador.

Um MBC3 do tipo 0x0F possui RTC e bateria sem RAM externa. Nesse caso `exportBatteryRam()` retorna um array vazio, indicando que há bateria a persistir. `null` continua significando ausência de bateria persistível. O RTC é fornecido separadamente por `exportBatteryRtc()`.

## Política de tempo do RTC

Durante a execução, o RTC recebe T-cycles do barramento, inclusive durante HALT. Um segundo equivale a 4.194.304 T-cycles. O núcleo não consulta data, relógio do sistema, navegador ou armazenamento. Pausar a emulação também pausa esse avanço. O bit halt do próprio cartucho suspende o RTC sem acumular os ciclos descartados.

O adaptador de persistência pode calcular um intervalo offline e chamar `advanceRtcSeconds(seconds)` ao reabrir uma bateria. Esse intervalo deve ser um número inteiro, não negativo e seguro. O núcleo aplica apenas o intervalo recebido e respeita halt. Ele não infere quanto tempo passou.

Save states e rewind conservam o instante exato salvo, incluindo a fase subsegundo, os registradores do mapper e a cópia latched. Carregar um checkpoint não aplica tempo offline. A compensação de tempo pertence exclusivamente à reabertura da bateria no adaptador.

O latch requer a sequência exata de escrita 0x00 seguida de 0x01 em 0x6000 a 0x7FFF. Essa operação copia o relógio vivo para os cinco registradores de leitura. O relógio continua avançando. Escritas nos registradores alteram o relógio vivo, e a próxima sequência de latch atualiza a leitura.

O contador de dias usa nove bits e faz wrap após 511. O carry permanece ligado até uma escrita do jogo limpá-lo. Segundos, minutos e horas conservam os bits fisicamente graváveis, inclusive valores fora da faixa usual. O estado valida esses bits sem transformar silenciosamente entradas corrompidas.

Uma escrita no registrador de segundos zera a fase subsegundo, mesmo quando o valor inteiro não muda. Escritas nos outros registradores preservam a fase. Valores inválidos como 63 segundos passam pelo wrap binário para zero sem propagar carry. Esses detalhes seguem as expectativas publicadas pelo autor de rtc3test; o projeto os cobre com testes próprios, sem declarar execução da ROM externa rtc3test.

## Contrato entre núcleo e adaptador

```ts
interface CartridgeRtcState {
  version: 1
  seconds: number // 0 a 63
  minutes: number // 0 a 63
  hours: number // 0 a 31
  days: number // 0 a 511
  halted: boolean
  carry: boolean
  subsecondTCycles: number // 0 a 4.194.303
}
```

Os métodos opcionais do cartucho são `tick(tCycles)`, `advanceRtcSeconds(seconds)`, `exportBatteryRtc()` e `importBatteryRtc(state)`. `parseCartridgeRtcState(value)` valida e cria uma cópia do objeto para consumidores externos. A importação inválida não altera a máquina. A revisão de bateria aumenta quando RAM, segundos inteiros ou registradores RTC mudam. Uma restauração que muda o RTC também aumenta a revisão. Essa revisão é monotônica e não volta ao valor do checkpoint.

## Referências primárias

- [Pan Docs: MBC2](https://gbdev.io/pandocs/MBC2.html), com [fonte consultada](https://github.com/gbdev/pandocs/blob/master/src/MBC2.md).
- [Pan Docs: MBC3](https://gbdev.io/pandocs/MBC3.html), com [fonte consultada](https://github.com/gbdev/pandocs/blob/master/src/MBC3.md).
- [Pan Docs: MBC5](https://gbdev.io/pandocs/MBC5.html), com [fonte consultada](https://github.com/gbdev/pandocs/blob/master/src/MBC5.md).
- [Pan Docs: cabeçalho](https://gbdev.io/pandocs/The_Cartridge_Header.html).
- [Mooneye: decodificação RAMG do MBC2](https://github.com/Gekkio/mooneye-test-suite/blob/main/emulator-only/mbc2/bits_ramg.s) e [RAM do MBC2](https://github.com/Gekkio/mooneye-test-suite/blob/main/emulator-only/mbc2/ram.s).
- [Mooneye: ROM de 64 Mbit no MBC5](https://github.com/Gekkio/mooneye-test-suite/blob/main/emulator-only/mbc5/rom_64Mb.s).
- [rtc3test: descrições de testes de limites, carry e fase subsegundo](https://github.com/aaaaaa123456789/rtc3test/blob/master/tests.md).

As fixtures unitárias e de integração são sintéticas e próprias. Os testes não dependem de ROM comercial ou boot ROM original. Resultados de suítes externas devem ser registrados somente após sua execução.

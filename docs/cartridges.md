# Cartuchos e jogos

## Jogar sem carregar arquivos

A biblioteca inclui **Tobu Tobu Girl** e **2048**, homebrews com redistribuição autorizada. **Explorar jardim** abre POCKET GARDEN, uma ROM própria e sem música para explorar o emulador. O catálogo não aumenta automaticamente com o suporte a novos controladores.

| Jogo           | Ações principais                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Tobu Tobu Girl | Start abre o menu, A confirma; direcionais e A/B controlam a partida. Start também pode pular a abertura. |
| 2048           | Start ou A inicia; direcionais movem e combinam peças.                                                    |
| Jardim         | Direcionais movem; A troca a aparência; B retorna ao início.                                              |

Os [créditos](third-party.md) registram autores, licenças e procedência. Os binários e avisos originais ficam em `public/games/`.

## Carregar um cartucho próprio

Use **Carregar cartucho** ou arraste um arquivo `.gb` obtido com autorização. Um `.gbc` só funciona se também for compatível com o Game Boy original. Extraia arquivos `.zip` antes. Não é necessário fornecer BIOS ou boot ROM.

O arquivo permanece no dispositivo. O carregamento confere cabeçalho, tamanho real, perfil DMG e limites do controlador, exibindo avisos ou recusas úteis. A ajuda **Quais arquivos posso usar?** fica junto do carregamento.

| Controlador | ROM máxima | RAM e particularidades                                               |
| ----------- | ---------- | -------------------------------------------------------------------- |
| ROM Only    | 32 KiB     | Até 8 KiB de RAM; sem bancos.                                        |
| MBC1        | 2 MiB      | Até 32 KiB de RAM para ROM até 512 KiB; até 8 KiB para ROM maior.    |
| MBC2        | 256 KiB    | 512 nibbles internos, persistidos em 512 bytes.                      |
| MBC3        | 2 MiB      | Até 32 KiB de RAM; RTC somente quando declarado pelo cartucho.       |
| MBC5        | 8 MiB      | Até 128 KiB de RAM; variante rumble até 64 KiB, sem vibração física. |

ROMs precisam ter tamanho em potência de dois. A convenção homebrew de 2 KiB de RAM é aceita com aviso. MBC1M, MBC30, controladores não listados e jogos exclusivos de Game Boy Color ficam fora do escopo.

## Progresso e relógio

Bateria guarda o que o próprio jogo decide salvar. Slots e arquivos `.pocketstate` guardam a máquina completa; carregar mantém o jogo em pausa. Restaurar um ponto antigo também pode voltar o progresso da bateria. Os dados são locais ao navegador e ao endereço do site; exporte estados antes de limpar dados ou mudar de dispositivo.

No MBC3, o RTC avança por T-cycles durante a execução. Pausar a máquina ou acionar o halt do cartucho suspende esse avanço. Ao reabrir uma bateria, o adaptador aplica o intervalo offline, respeitando halt. Save states e rewind restauram o instante salvo, sem acrescentar esse intervalo.

A leitura latched é atualizada pela sequência 0x00 seguida de 0x01; o contador usa nove bits de dias e carry persistente. Baterias RTC v2 preservam compatibilidade com RAM v1 e suportam cartuchos com relógio sem RAM. Os contratos internos ficam no código e em testes próprios; não há alegação de aprovação de uma ROM externa de RTC.

Referências: [Pan Docs: cabeçalho](https://gbdev.io/pandocs/The_Cartridge_Header.html), [MBC1](https://gbdev.io/pandocs/MBC1.html), [MBC2](https://gbdev.io/pandocs/MBC2.html), [MBC3](https://gbdev.io/pandocs/MBC3.html) e [MBC5](https://gbdev.io/pandocs/MBC5.html).

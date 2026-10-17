# Testar M00, M01 e M02

Roteiro histórico do primeiro grupo, já aprovado pelo proprietário. A aplicação atual inclui recursos de milestones posteriores.

1. Execute `npm.cmd run dev` e abra o endereço exibido.
2. Troque entre DMG, Pocket e Light e confira o layout.
3. Escolha **Experimentar cartucho de diagnóstico**. O header deve mostrar POCKET TEST, ROM Only, 32 KiB de ROM e 0 KiB de RAM.
4. Abra **Inspecionar CPU**. Uma instrução muda PC de 0100 para 0150.
5. Escolha **Até 1000 instruções**. A ROM própria termina em HALT, com PC 017D e saída serial OK.
6. Reinicie a CPU. PC volta a 0100, ciclos a zero e a serial é limpa.
7. Um cartucho truncado deve gerar uma mensagem útil. Na versão atual, consulte os [mappers suportados](cartridge-mappers.md) antes de selecionar uma ROM própria.

A CPU implementa as instruções base válidas e as 256 instruções CB. Opcodes inválidos geram diagnóstico. A inicialização pós boot DMG inclui F dependente do checksum do header; não reproduz todas as revisões físicas. STOP suspende o clock, redefine o divisor e retoma após borda de entrada do joypad.

Consulte o [roteiro atual](testing-m12-m14.md) para testar a candidata a lançamento.

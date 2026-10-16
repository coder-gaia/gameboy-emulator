# Regras do projeto

## Autoria e commits

- Nunca atribuir autoria, coautoria ou colaboração de commits a Codex ou OpenAI.
- Usar exclusivamente a identidade Git do proprietário, sem inventar nomes ou emails.
- Não incluir trailers de atribuição a ferramentas de IA.
- Criar um commit por milestone concluída, seguindo Conventional Commits.
- Escrever o título do commit em inglês e o corpo em pt-br.
- Conferir mensagem, autor e committer antes de enviar cada commit.
- Fazer push imediatamente após cada commit validado, sem acumular commits para o final do grupo.
- Confirmar o commit no GitHub antes de avançar para a próxima milestone. Não enviar links individuais de commits, salvo pedido.
- Pausar ao concluir cada grupo de três milestones para o proprietário testar.
- Na pausa, entregar instruções concretas de teste e os resultados esperados. Aguardar o ok antes de continuar.
- Os grupos M00 a M02, M03 a M05 e M06 a M08 foram aprovados pelo proprietário.
- M09, M10 e M11 estão autorizadas. Pausar ao concluir M11 e entregar roteiro de testes antes de iniciar M12.
- Como último passo deste grupo, ajustar o fundo para pastel/off-white confortável, preservando contraste e aparência do console, sem aplicar opacidade ou sobreposição ao Game Boy.

## Escrita

- Não utilizar os caracteres Unicode U+2013 e U+2014 em nenhum conteúdo produzido.
- Usar pt-br na interface e documentação. Identificadores de código ficam em inglês.

## Arquitetura e escopo

- Um repositório e um pacote npm. Sem monorepo no V1.
- TypeScript estrito, React e Vite. Deploy estático futuro no Cloudflare Pages Free.
- O núcleo em src/core não importa DOM, React, Web Audio, armazenamento ou APIs de navegador.
- Usar T-cycles como unidade explícita de tempo. Quatro T-cycles equivalem a um M-cycle.
- Memória e buffers utilizam arrays tipados. Evitar alocações no caminho quente.
- Nenhum backend, conta, upload de ROM ou serviço pago.
- Não distribuir ROM comercial, boot ROM original ou ativos sem permissão clara.
- Não prometer aprovação de testes que ainda não foram executados.
- Preservar plano-emulador-gameboy.md como documento original.

## Qualidade

- Antes de encerrar uma milestone, executar npm run check e os testes pertinentes.
- Manter README e docs/milestones.md coerentes com o estado real.
- Corrigir causas das falhas sem enfraquecer checks ou excluir casos válidos.
- Testes de CPU, bus e cartucho devem rodar sem navegador.
- Interface com foco visível, contraste, teclado, toque e movimento reduzido.
- Explicar os formatos de cartucho perto do carregamento e validar arquivos com mensagens úteis. ROMs próprias ficam locais.
- Design com superfícies neutras e uma cor de destaque usada estrategicamente.

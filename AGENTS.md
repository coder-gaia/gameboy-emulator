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
- Na pausa, entregar instruções curtas e concretas de teste diretamente no chat, com os resultados esperados. Não criar documentos de roteiro. Aguardar o ok antes de continuar.
- Os grupos M00 a M02, M03 a M05 e M06 a M08 foram aprovados pelo proprietário.
- M09, M10 e M11 estão concluídas. O proprietário aprovou o desktop e reportou lentidão mobile somente depois de ativar o som no Motorola Edge 40 Neo com Chrome.
- Em 17/10/2026, o proprietário autorizou M12 a M14, com correção do áudio mobile e setas de toque maiores, preservando o desktop aprovado. O diagnóstico histórico está no Git; decisões atuais ficam em docs/architecture.md.
- Não declarar desempenho mobile homologado apenas com viewport Pixel 7 ou CPU throttle da página. Validar áudio e velocidade no aparelho real; o Worker não foi desacelerado pelo throttle da página no experimento registrado.
- Após o deploy da M12 em 17/10/2026, o proprietário confirmou Tobu sem travadas e música contínua no Motorola. Sem som fica 100% fluido; com som ainda percebe lentidão. O desktop continua perfeito. Usar as métricas da M13 para distinguir velocidade emulada e frequência de apresentação antes de atribuir a diferença ao aparelho; a homologação completa segue pendente.
- M12 a M14 foram enviadas ao GitHub e tiveram CI e publicação conferidos. O teste físico da candidata 1.0.0-rc.1 reportou regressão grave com som. O diagnóstico do Tobu mediu 99,7% de velocidade emulada e 31,9 desenhos/s; a troca de relógio durante reposição PCM foi reproduzida no código.
- Em 17/10/2026, o proprietário autorizou corrigir e iterar até obter fluidez com som. A rc.2 preserva o histórico do relógio, amplia a margem de PCM e vídeo e inclui regressões de alta latência. Aguardar o teste físico antes de afirmar aceite; estudar outro jogo somente depois da fluidez validada.
- O teste físico da rc.2 registrou melhora da continuidade, mas atraso percebido de cerca de 1,5 segundo no toque. O diagnóstico do smartphone mediu 100,2% de velocidade, 51,2 desenhos/s e zero faltas ou perdas PCM. A rc.3 separa o relógio interativo da reprodução sonora e inclui medição de entrada até pixel. Preservar continuidade do áudio sem usar a saída do alto-falante para reter a imagem.
- Em 17/10/2026, o proprietário aprovou o teste da rc.3 com Tobu e som ativo no Motorola Edge 40 Neo com Chrome: controles rápidos e música contínua. Esse aceite atende à condição para estudar outro homebrew. A regressão automatizada desktop passou; release estável e divulgação continuam dependendo de instrução do proprietário.
- O proprietário escolheu MIT para o código próprio, com autoria de Alexandre Gaia no LICENSE e README. Preservar licenças e créditos separados dos componentes de terceiros.
- Não publicar em rede social nem criar release estável antes do aceite do grupo. Rascunhos históricos de divulgação permanecem no Git.
- Preservar o fundo pastel/off-white confortável e o contraste e aparência do console, sem aplicar opacidade ou sobreposição ao Game Boy.

## Escrita

- Não utilizar os caracteres Unicode U+2013 e U+2014 em nenhum conteúdo produzido.
- Usar pt-br na interface e documentação. Identificadores de código ficam em inglês.

## Arquitetura e escopo

- Um repositório e um pacote npm. Sem monorepo no V1.
- TypeScript estrito, React e Vite. Deploy estático no Cloudflare Pages Free.
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
- Manter docs enxuto: decisões de arquitetura, cartuchos, deploy, validação técnica, milestones e créditos. Evitar relatórios brutos, roteiros de teste por grupo, rascunhos de divulgação e duplicação de conteúdo.
- Corrigir causas das falhas sem enfraquecer checks ou excluir casos válidos.
- Testes de CPU, bus e cartucho devem rodar sem navegador.
- Interface com foco visível, contraste, teclado, toque e movimento reduzido.
- Explicar os formatos de cartucho perto do carregamento e validar arquivos com mensagens úteis. ROMs próprias ficam locais.
- Design com superfícies neutras e uma cor de destaque usada estrategicamente.

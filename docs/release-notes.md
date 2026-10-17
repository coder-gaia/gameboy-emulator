# Pocket Lab 1.0.0-rc.1

**Candidata em validação, em 17 de outubro de 2026.** Este documento prepara as notas da release. Não cria tag, GitHub Release ou publicação em rede social. O aceite de fluidez com áudio no Motorola Edge 40 Neo com Chrome continua pendente; a versão final depende dessa revisão.

[Abrir a beta](https://gameboy-emulator-aox.pages.dev/) · [Repositório](https://github.com/coder-gaia/gameboy-emulator) · [Roteiro de teste](testing-m12-m14.md)

## O que a candidata reúne

O Pocket Lab executa o Game Boy DMG no navegador, com núcleo TypeScript independente de DOM, React ou Web Audio. A interface oferece Tobu Tobu Girl e 2048 com permissões de distribuição preservadas, além do jardim próprio de diagnóstico. Cartuchos do visitante são lidos localmente.

- CPU SM83, bus, timer, interrupções, DMA, vídeo e quatro canais da APU, com tempo explícito em T-cycles.
- ROM Only, MBC1, MBC2, MBC3 com RTC nos tipos adequados e MBC5. Os [limites de cada controlador](cartridge-mappers.md) permanecem explícitos.
- Saves de bateria, três slots por ROM, importação e exportação de estados `.pocketstate`, com versões e validação de integridade.
- Rewind opcional de até 20 segundos, em buffers de histórico limitados a 8 MiB, independente dos slots persistidos.
- Teclado remapeável, gamepad padrão, toque com setas maiores, tela cheia e preferências locais.
- Painel técnico com desassemblador, atlas de tiles, OAM, páginas de memória e registradores, sem escrever ou avançar a máquina durante a inspeção.
- Painel de desempenho e áudio com medição local de 60 segundos e exportação de diagnóstico JSON sem ROM, memória ou progresso do jogo.
- Deploy estático no Cloudflare Pages Free, por integração com GitHub, sem backend ou upload de cartuchos.

## Mudanças do grupo M12 a M14

A M12 amplia os controladores de cartucho e implementa o RTC com persistência de bateria. O abastecimento de áudio deixa de depender de reposições sempre pequenas: usa o déficit da fila e o atraso observado no Worklet para ajustar a reserva, com pedidos e memória limitados. As setas de toque chegam a 52 px com ícones de 22 px quando há espaço, preservando alvos de 44 px em 320 px e os tamanhos desktop aprovados.

A M13 acrescenta inspeção de hardware e diagnóstico de velocidade, apresentação e PCM. As consultas técnicas ficam suspensas com o painel fechado ou a aba oculta. O JSON exportado permite revisar uma janela sem enviar dados a um serviço.

A M14 prepara esta candidata, as notas, o material de portfólio e os rascunhos de divulgação. A apresentação preserva os quadros intermediários dos lotes PCM, usa buffers limitados e acompanha uma estimativa do cursor de áudio. A geração da conexão protege a troca de cartucho e a ativação concorrente com o início do jogo. O [relatório de vídeo e áudio](performance-video-results.json) registra o build e os resultados medidos; não se considera a percepção de lentidão resolvida no telefone antes do teste real.

O fundo permanece creme `#eee9df`. O console conserva seu material, contraste e opacidade normal, sem camada aplicada sobre o Game Boy. As imagens de apresentação foram capturadas da aplicação, usando o jardim próprio.

## Evidências disponíveis

A base fechada da M13 passou por 1.395 testes locais, 103 casos externos de hardware, 176 cenários de interface e 16 testes de produção. Os resultados completos e as repetições necessárias estão no [acompanhamento das milestones](milestones.md). A publicação da M13 foi conferida contra os hashes do artefato congelado; esses resultados não antecipam o fechamento da M14.

A [regressão isolada de áudio da M12](performance-audio-mobile-results.json) cobriu os três cartuchos em Chromium no computador, incluindo perfil móvel simulado e atraso controlado de mensagens. Ela não homologa um telefone físico. O [diagnóstico MB01](mobile-audio-investigation.md) e a [documentação de métricas](performance-metrics.md) separam os limites dessas observações.

O proprietário aprovou desktop. Depois da M12, confirmou música contínua e ausência de travadas no Motorola, mas ainda percebeu movimento lento com o som ativo. A validação final deve comparar janelas de 60 segundos com e sem áudio e sessões de cinco minutos no aparelho, preservando pausa, slots, rewind e saves. Os resultados reais dessa revisão permanecem pendentes.

## Limites conhecidos

A PPU usa renderização por scanline e não implementa pixel FIFO completo, alterações raster dentro do modo 3 ou todos os detalhes de WX. Os testes externos não comprovam equivalência integral de vídeo ou áudio com cada revisão física do console. O estado inicial pós boot também não substitui a reprodução de todas as boot ROMs originais.

Jogos exclusivos de Game Boy Color, MBC1M, MBC30, multiplayer e sincronização em nuvem ficam fora do escopo. Rumble não produz vibração física. Formatos, tamanhos e compatibilidade dos cartuchos são explicados perto do carregamento.

Saves pertencem ao navegador e à origem do site. Limpar dados ou mudar para outro domínio não transfere progresso. O usuário pode exportar estados como backup. Áudio depende de suporte a AudioWorklet, HTTPS ou localhost e uma ação explícita para ativação.

## Créditos e distribuição

Não são distribuídos jogos comerciais ou boot ROM original. Os dois homebrews incluídos preservam binários, autores, licenças e créditos. O jardim e o cartucho de diagnóstico são próprios. Consulte [jogos demonstrativos](demo-games.md) e [conteúdo de terceiros](third-party.md).

Não foi definida uma licença geral para redistribuir o código próprio do projeto. As licenças das dependências, fontes, ícones e jogos não concedem automaticamente uma licença ao conjunto.

## Fechamento automatizado da M14

A candidata passou pelo check completo com 1.473 testes locais, 103 testes externos, 176 cenários de interface, 16 testes de produção e seis janelas isoladas de áudio e vídeo. A fonte final e o artefato medido coincidem pelos hashes. O [roteiro do grupo](testing-m12-m14.md) orienta o aceite pendente no aparelho real e a conferência do deploy. Nenhuma tag ou release estável foi criada antes dessa revisão.

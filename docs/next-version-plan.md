# Próxima versão: Big2Small e modo escuro

Estado: planejamento. A implementação começa em outra rodada, após autorização do proprietário. A versão pública atual permanece como está.

## Escopo e sequência

| Marco | Entrega                         | Aceite esperado                                                                             |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| M15   | Big2Small na biblioteca         | ROM original, créditos e fonte correspondente disponíveis; partida e progresso funcionando. |
| M16   | Alternância claro/escuro        | Tema confortável e persistente, sem mudar o jogo nem interromper a execução.                |
| M17   | Validação conjunta e publicação | Regressões aprovadas e grupo pronto para teste do proprietário.                             |

Manter um repositório, um pacote npm e deploy estático no Cloudflare Pages Free. O núcleo e o transporte de áudio aprovados na rc.3 são a base da próxima versão. A numeração da versão será definida antes da publicação.

## M15: Big2Small

### Procedência e distribuição

- Usar a [ROM oficial v1.0.0](https://github.com/mdsteele/big2small/releases/download/v1.0.0/big2small.gb), de Matthew D. Steele, sem modificar seus bytes.
- Conferir 65.536 bytes e SHA-256 `59c096333f93c12c8eb25a5fcffa2be15001abcd5d20b9a82c2bc2dae7e625b2` antes de versionar o binário.
- Registrar no manifesto a origem, versão, revisão exata do fonte, tamanho, hash, MBC5 e RAM com bateria. O cartucho é compatível DMG/GBC, com 64 KiB de ROM e 8 KiB de RAM.
- Preservar a [GPL da versão distribuída](https://github.com/mdsteele/big2small/blob/v1.0.0/LICENSE), autoria e avisos de arte, música e demais componentes. A licença do jogo é GPL-3.0-or-later; a MIT do emulador permanece separada.
- Oferecer, junto dos créditos e do acesso ao jogo, o fonte completo correspondente à ROM distribuída, com arquivos de construção, ativos e instruções necessárias. Fixar revisão e hash do arquivo; um link genérico para a branch atual não atende ao plano.

### Integração

1. Criar `public/games/big2small/` com ROM, avisos, atribuição e arquivo do fonte correspondente. Atualizar `public/games/manifest.json`.
2. Adicionar a entrada em `src/platform/games/catalog.ts`, usando o carregamento e a verificação de integridade existentes. O catálogo alimenta a interface; o manifesto registra a procedência. A biblioteca deve mostrar os três jogos sem prejudicar toque ou teclado.
3. Descrever controles reais e o objetivo do jogo em pt-br, após conferir a ROM. Explicar a troca de animais e a interação somente conforme as ações verificadas.
4. Reutilizar bateria por identidade da ROM, slots, arquivos de estado e rewind existentes. Evitar qualquer caminho exclusivo de emulação para esse jogo.
5. Atualizar os trechos de README, cartuchos, créditos e ajuda em `App.tsx` que enumeram apenas os dois jogos atuais. Não transformar a documentação em relatório de execução.

### Validação e limite conhecido

A exploração local já abriu a primeira fase, respondeu às direções e produziu PCM sem exceção no núcleo. Isso não valida todas as fases, saves, AudioWorklet ou desempenho no celular.

Verificar hash e cabeçalho em Node; testar abertura e início de partida no navegador, recusa de binário alterado, save do próprio jogo após recarregar, slots e rewind. Em `tests/e2e/library.spec.ts`, substituir a expectativa única de MBC1 por verificações do controlador de cada jogo: preservar MBC1 para os atuais e conferir MBC5 para Big2Small. Incluir o novo jogo nos cenários pertinentes de áudio contínuo e medir resposta dos controles com som ativo. Preservar os limites das suítes existentes.

## M16: modo claro e escuro

### Direção visual e decisão pendente

- Preservar o claro atual em off-white `#eee9df` e adotá-lo como padrão quando não houver escolha salva.
- Explorar grafite levemente esverdeado, superfícies em tons próximos e texto marfim para o escuro. Evitar preto intenso; reservar a cor de destaque para foco, ações e estados relevantes.
- Preservar volume visual, bordas e contraste do console. Não aplicar opacidade, filtros ou uma camada sobre o Game Boy para escurecer a página.
- Manter as paletas DMG, Pocket e Light independentes do tema da interface. Os pixels dos jogos não mudam ao alternar claro/escuro.
- Discutir com o proprietário o local do toggle antes de implementá-lo. Proposta inicial: no cabeçalho, próximo de Sobre, visível no desktop e no mobile. A posição ainda não está aprovada.

### Implementação

1. Mapear cores fixas de fundos, textos, bordas, foco e estados dos CSS Modules. Centralizar tokens em `src/ui/global.css` e definir os dois temas por atributo no elemento raiz.
2. Acrescentar a preferência `light` ou `dark` em `src/platform/settings/preferences.ts`, com schema v2 e migração de v1. Preservar volume, mute, paleta e teclas; lidar com dados inválidos ou armazenamento indisponível.
3. Aplicar a preferência no início da aplicação para evitar um clarão antes do tema salvo. Respeitar a CSP existente, sem scripts inline ou recursos externos.
4. Criar toggle com nome acessível, estado anunciado, foco visível e acionamento por teclado e toque. Alvo mínimo de 44 por 44 pixels, sem reduzir as setas do console. Evitar depender da abertura do painel de preferências, que atualmente pausa o jogo.
5. Adaptar biblioteca, controles, avisos, diálogos, inspeção e tela cheia. Garantir contraste de texto e controles nos dois temas e respeitar movimento reduzido.
6. Alternar tema sem recriar Worker, AudioContext ou Canvas, sem recarregar ROM e sem pausar, perder progresso ou interromper som e controles.

### Validação

Cobrir migração e persistência em testes locais. No navegador, verificar os dois estados do toggle, teclado, recarga, contraste, foco, diálogos e ausência de rolagem horizontal a partir de 320 pixels. Comparar as paletas de jogo antes e depois da troca e confirmar a continuidade da mesma sessão de emulação.

## M17: integração, publicação e pausa

1. Executar `npm run check`, testes de hardware, E2E, produção e fluxo de áudio. Investigar falhas preservando os critérios existentes.
2. Revisar os três jogos nos dois temas em desktop e layout mobile, incluindo controles, som, bateria, estados, rewind, avisos e tela cheia. Não repetir toda a matriz em cada teste quando uma verificação de contrato for suficiente.
3. Atualizar a versão, as entregas e os créditos de acordo com o resultado real. Conferir build, CSP e identidade dos artefatos publicados.
4. Entregar no chat um roteiro curto para o Motorola Edge 40 Neo com Chrome e para o desktop. Incluir partida e save no Big2Small, troca de tema com música ativa e regressão do Tobu. Os resultados automatizados não substituem esse aceite físico.
5. Pausar ao concluir M15 a M17 e aguardar o ok do proprietário. Se o teste físico revelar regressão, tratá-la antes de declarar a nova versão homologada.

Cada milestone terá um commit Conventional Commits, título em inglês e corpo em pt-br. Usar exclusivamente a identidade Git do proprietário, sem atribuição a ferramentas de IA; conferir mensagem, autor e committer, fazer push imediato e confirmar o commit no GitHub antes de avançar. Não publicar automaticamente no LinkedIn nem alterar o portfólio.

Títulos previstos: `feat: add Big2Small to the game library`, `feat: add a persistent dark theme` e `chore: validate and publish the next release`.

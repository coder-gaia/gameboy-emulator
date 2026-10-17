# Deploy no Cloudflare Pages

Produção: **[gameboy-emulator-aox.pages.dev](https://gameboy-emulator-aox.pages.dev/)**. O projeto já está conectado ao GitHub. O site é estático, sem Functions, backend, tokens locais ou upload de ROM.

## Acompanhar uma atualização

1. Entre no [painel Cloudflare](https://dash.cloudflare.com/), abra **Workers & Pages** e selecione o projeto desse domínio.
2. Em **Deployments**, abra a publicação de **Production** mais recente. Confira a branch `main`, o commit e o resultado do build.
3. Confira também o workflow **Quality** do mesmo commit no GitHub. A pipeline da Cloudflare é independente dos checks.
4. Abra o site, recarregue a aba e confira a versão em **Sobre o projeto**. A candidata desta revisão é **1.0.0-rc.2**.

Um push em `main` dispara o deploy pela integração existente. Não precisa criar outro projeto nem enviar `dist` manualmente. Se o build falhar, consulte o log da etapa; a produção permanece na última publicação bem-sucedida. [Integração Git oficial](https://developers.cloudflare.com/pages/get-started/git-integration/).

## Configuração

| Campo             | Valor                                |
| ----------------- | ------------------------------------ |
| Plano             | Free                                 |
| Repositório       | `coder-gaia/gameboy-emulator`        |
| Production branch | `main`                               |
| Framework         | React (Vite)                         |
| Build command     | `npm run build`                      |
| Output directory  | `dist`                               |
| Root directory    | Raiz do repositório, campo vazio     |
| Node              | `22.13.0`, fixado em `.node-version` |

Se o painel exigir configuração explícita de Node, use `NODE_VERSION=22.13.0`. Para refazer a conexão, escolha Pages e a opção de importar um repositório Git; autorize somente este repositório e aplique a tabela. [Configuração de build](https://developers.cloudflare.com/pages/configuration/build-configuration/).

## Validar a publicação

Na raiz, execute `npm.cmd run check` e `npm.cmd run test:production`. A suíte de produção usa o build local com CSP. Para a URL já publicada:

```powershell
$env:POCKETLAB_PRODUCTION_URL = 'https://gameboy-emulator-aox.pages.dev'
try {
  npm.cmd run test:production -- --workers=2
} finally {
  Remove-Item Env:\POCKETLAB_PRODUCTION_URL -ErrorAction SilentlyContinue
}
```

Confirme jogos, Worker e AudioWorklet sem 404 ou violações CSP. `public/_headers` define cache imutável para `/assets/*` e revalidação de HTML e jogos. Para conferir manualmente o artefato local, execute `npm.cmd run preview:production` após o build; o servidor de QA aplica os cabeçalhos em `http://127.0.0.1:4174/`.

Áudio exige HTTPS ou localhost e uma ação do usuário. A hospedagem estática elimina o início de um processo de servidor na visita; download e inicialização no navegador continuam existindo.

Saves pertencem à origem. Produção, previews e localhost possuem dados separados. Recarregar atualiza a página sem apagar saves; limpar dados do site os remove. Exporte estados antes de trocar de endereço.

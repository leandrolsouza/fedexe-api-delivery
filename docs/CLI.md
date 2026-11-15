# Runner do Fedexe no Windows

Use o menu da coleção para exportar o JSON do Fedexe. Na tela **Environments**, exporte o ambiente que a execução deve usar. Para rodar só uma pasta, passe o nome exato com `--folder`. A ordem das requisições segue a coleção exportada, inclusive quando uma pasta é selecionada.

Baixe o artefato **fedexe-cli-windows-x64** do workflow **Windows collection runner** ou execute `npm ci` e `npm run build:cli` com Node.js 22 e o toolchain Rust MSVC. Mantenha `fedexe.mjs` e `fedexe-runner.exe` juntos. Os binários gerados localmente ficam em `dist-cli`.

```powershell
node dist-cli/fedexe.mjs run --collection ./ci/collection.json --environment ./ci/environment.json --folder 'Integração' --secret 'password=API_TEST_PASSWORD' --stop-on-failure --report ./fedexe-report.json
```

`--environment` é obrigatório. Use um ambiente exportado com a lista de variáveis vazia quando a coleção dispensar variáveis de ambiente. Caminhos relativos para arquivos de corpo são resolvidos a partir do diretório de trabalho. O relatório deve apontar para um arquivo novo.

## Variáveis e segredos

A precedência inicial, da menor para a maior, é coleção, ambiente e mapeamentos `--secret`. Cada mapeamento associa um nome usado em `{{variavel}}` a uma variável do processo. Repita a opção para fornecer vários valores. Um header marcado como secreto e exportado vazio recebe seu valor de um mapeamento com o nome do próprio header. As extrações de uma etapa substituem a variável de mesmo nome para as etapas seguintes.

Use referências a variáveis nos campos de autenticação e configure os valores no ambiente do processo. O console e o JSON registram o número da etapa, status HTTP, contagem de verificações, tempos e resultado. A CLI omite nomes de requisições, mensagens do servidor, variáveis e detalhes de erros que possam conter credenciais ou tokens.

| Código | Resultado |
| --- | --- |
| `0` | Todas as etapas executadas passaram. |
| `1` | Falhou uma verificação declarativa ou uma extração. |
| `2` | Houve erro de configuração ou execução, como arquivo inválido, variável ausente ou falha de rede. Tem prioridade sobre o código `1`. |

Por padrão a execução continua após uma falha. Com `--stop-on-failure`, o relatório inclui as etapas concluídas até a primeira falha.

## GitHub Actions

Exemplo para um checkout do Fedexe com os arquivos exportados em `ci/`. Configure `API_TEST_PASSWORD` nos segredos do repositório.

```yaml
name: API integration tests
on: [workflow_dispatch]
jobs:
  api:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run build:cli
      - name: Run integration tests
        env:
          API_TEST_PASSWORD: ${{ secrets.API_TEST_PASSWORD }}
        run: >
          node dist-cli/fedexe.mjs run
          --collection ci/collection.json --environment ci/environment.json
          --secret password=API_TEST_PASSWORD --stop-on-failure --report fedexe-report.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: fedexe-report
          path: fedexe-report.json
```

## OAuth 2.0 Client Credentials

No editor de autorização da coleção ou requisição, selecione **OAuth 2.0 → Client Credentials**. Configure a URL de token, o Client ID e o escopo opcional. Em **Client secret**, use uma referência como `{{oauth_client_secret}}`. Exporte a coleção e configure `OAUTH_CLIENT_SECRET` no ambiente do processo ou nos segredos do CI.

```powershell
node dist-cli/fedexe.mjs run --collection ./ci/collection.json --environment ./ci/environment.json --secret 'oauth_client_secret=OAUTH_CLIENT_SECRET' --report ./fedexe-report.json
```

O runner envia o Client ID e o segredo com `client_secret_basic`, usa o token Bearer nas requisições protegidas e mantém em memória os tokens com validade informada pelo provedor. Ele solicita outro token após a expiração. Use HTTPS no provedor e no recurso protegido. Para provedores locais de teste, use HTTP com um IP de loopback. Authorization Code com PKCE é executado no desktop.

Em GitHub Actions, associe `OAUTH_CLIENT_SECRET: ${{ secrets.OAUTH_CLIENT_SECRET }}` ao `env` do passo que executa o runner.

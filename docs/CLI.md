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

## Testes de carga

No desktop, abra o **Runner de coleções**, selecione **Teste de carga** e escolha a coleção ou pasta e o ambiente. Use requisições salvas na ordem em que o usuário as executaria. Para encadear autenticação e dados, configure extrações JSON Pointer e use as variáveis extraídas nas etapas seguintes. Cada VU recomeça com as variáveis originais em cada rodada. Uma falha declarativa, de extração ou de transporte encerra a rodada daquele VU.

O modo de carga executa testes e extrações declarativos. Se o fluxo usa JavaScript, confirme **Executar este teste de carga sem scripts JavaScript** no desktop ou use `"skip_scripts": true` no cenário do CLI. Para manter a autenticação e a preparação dos dados durante o teste de carga, configure as etapas correspondentes como requisições, variáveis e extrações da coleção.

No desktop, também é possível escolher **Rodar o pré-script da coleção uma vez antes da carga** para obter um token ou inicializar variáveis com o script existente. O runner usa as variáveis em todos os VUs daquela execução e descarta os valores no fim. As chamadas do pré-script ficam fora das métricas de carga. Para testes que excedem a validade do token, use uma etapa declarativa de login no fluxo para renová-lo durante a execução.

Use **Exportar cenário** para gerar o arquivo do CLI. Exemplo de rampa de 2 a 20 VUs em 30 segundos, seguida de 90 segundos com 20 VUs:

```json
{
  "profile": "ramp",
  "base_vus": 2,
  "vus": 20,
  "phase_seconds": 30,
  "duration_seconds": 120,
  "think_ms": 100,
  "max_p99_ms": 500,
  "max_error_percent": 1
}
```

```powershell
node dist-cli/fedexe.mjs load --collection ./ci/collection.json --environment ./ci/environment.json --folder 'Integração' --scenario ./ci/load.json --secret 'password=API_TEST_PASSWORD' --report ./fedexe-load.json
```

| Perfil | Agenda de usuários virtuais |
| --- | --- |
| `constant` | Inicia todos os VUs e mantém a concorrência até o fim. |
| `ramp` | Inicia com `base_vus`, adiciona VUs gradualmente durante `phase_seconds` e mantém o total até o fim. |
| `spike` | Mantém `base_vus` antes e depois de um pico central de `phase_seconds` com o total de VUs. Reserve pelo menos dois segundos fora do pico. |
| `soak` | Mantém os VUs durante uma janela prolongada. Cruze as métricas de latência e erros com o consumo de memória do serviço sob teste. |

Configure de 1 a 500 VUs e de 1 a 86.400 segundos de carga. A pausa opcional `think_ms` vai de 0 a 60.000 ms. Ao fim da janela de um VU, o runner permite que a requisição em andamento termine, respeitando seu timeout. Cancelar pelo desktop interrompe as requisições pendentes e conserva as métricas já coletadas.

O CLI emite uma amostra JSON por segundo em stderr, com RPS da janela mais recente. O resultado final em stdout e no arquivo de relatório contém RPS médio, latência média, p95 e p99, contagem de HTTP 4xx/5xx, erros de transporte, timeouts e falhas de validação. Cada requisição entra uma vez na taxa de erros, mesmo que pertença a mais de uma categoria. A taxa inclui HTTP 4xx/5xx e erros de transporte. Os percentis usam o método de posto mais próximo com histogramas de memória limitada. Latências acima de 10 s têm resolução reduzida no relatório. A comparação com o limite de p99 usa as amostras em milissegundos sem o arredondamento do histograma.

O passo de CI pode executar o comando `load` diretamente. O código `0` indica uma execução concluída com amostras e todos os limites configurados atendidos. O código `1` indica limite excedido e reprova o passo. O código `2` cobre configuração inválida, erro de preparação, cancelamento ou falta de amostras. Os dois limites são opcionais e aceitam igualdade. O cenário e o relatório exportados contêm configurações numéricas e métricas agregadas.

O relatório inclui `thresholds` com valor medido, limite e veredito de cada critério. `requests_by_step` agrega chamadas, erros, porcentagem e contagem por status HTTP 4xx/5xx em `http_errors_by_status`. O campo `step` começa em 1 e segue a ordem da coleção ou pasta selecionada. Falhas declarativas aparecem separadamente da taxa de erros. O desktop mostra o nome de cada requisição nas linhas com falhas. O JSON usa os números das etapas.

A aba **Evolução** e o campo `timeline` do relatório mostram RPS, p95, p99 e taxa de erros por janela de tempo, a partir do início da carga. O horário em `first_error_ms` corresponde à conclusão da primeira requisição com erro HTTP ou de transporte na janela. Janelas sem requisições têm RPS zero e percentis e taxa de erros ausentes. A janela mínima é de um segundo e aumenta em testes longos para limitar o histórico. A última janela pode incluir requisições concluídas após o fim da janela de carga.

Ao iniciar um teste no desktop, o runner abre a tela de resultados em largura total. No teste de carga, ela oferece **Resumo** e **Evolução**. No teste funcional, ela mantém as etapas, os filtros e o relatório. Em ambos, use **Voltar à configuração** para ajustar o cenário e **Ver resultados** para reabrir o último teste.

Ao escolher uma pasta no desktop, marque somente as requisições que devem rodar. O cenário de carga exportado para uma seleção parcial inclui `request_ids`. O CLI executa esses IDs no escopo informado e segue a ordem salva da coleção.

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

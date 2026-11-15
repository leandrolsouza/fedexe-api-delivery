# Interface do Fedexe API

## Direção de produto

O roadmap é de um cliente HTTP local, não de um dashboard de métricas. A interface prioriza o ciclo **organizar → configurar → enviar → validar → repetir**. Por isso, gráficos são usados apenas no resumo real do runner, sem números fictícios ou dependências de dashboard desnecessárias.

Visual: superfícies claras, acentos violeta, cores semânticas por método HTTP, fonte Inter empacotada localmente, espaços consistentes, estados vazios, foco visível e feedback de ações. Há temas claro, escuro e do sistema, além de layout compacto e adaptação a janelas menores. A interface está em português.

## Navegação

- **Coleções:** árvore de coleções/pastas, busca, menus contextuais, duplicação, renomeação, exclusão com confirmação, movimentação entre pastas e ordenação por arrastar ou pelo menu. Abas mantêm rascunhos separados. `Ctrl+S` salva a requisição.
- **Editor:** método, URL, query ativável com chaves repetidas, autorização herdada/nenhuma/Basic/Bearer/API key, headers, JSON, texto, formulário URL-encoded, testes declarativos e extração por JSON Pointer. URLs coladas com query são sincronizadas com a tabela. O motor recusa colisões entre headers e autorização.
- **Resposta:** status, duração, tamanho total no desktop, JSON formatado/original, números de linha, headers, testes e cópia da prévia. No Windows, o app grava o corpo completo em um arquivo temporário durante o recebimento e permite exportá-lo sem repetir a requisição. A prévia é limitada a 256 KiB e também pode ser baixada no navegador.
- **Ambientes:** criação, duplicação, renomeação, seleção, exclusão e variáveis. Segredos ficam mascarados e são recuperados do Gerenciador de Credenciais no Windows. No navegador ficam na sessão. Ambiente substitui variáveis da coleção; extrações do runner têm prioridade durante uma rodada.
- **Runner:** coleção inteira, pasta ou requisições selecionadas. Exige a escolha do ambiente e executa na ordem salva. Os testes verificam status, presença ou valor exato de header e campos JSON. No desktop, um valor igual em qualquer ocorrência de um header repetido satisfaz a regra. A extração por JSON Pointer disponibiliza strings, números e booleanos às etapas seguintes da rodada.
- **Histórico:** até 300 metadados de envios avulsos, busca, filtros e reabertura da requisição original. Não persiste corpos de resposta nem headers de autorização.
- **Console de requisições:** no desktop, reúne em memória os últimos 100 envios do editor e etapas do runner. Filtre pela origem ou por erro e abra um registro para conferir a requisição resolvida, os redirecionamentos e a resposta. A prévia tem até 8 KiB. JSON que não pode ser mascarado com segurança aparece como indisponível. O motor mascara credenciais, valores marcados como secretos e valores extraídos pelo runner antes de enviar os registros ao painel.
- **Configurações:** tema, densidade, quebra de linha, nome do workspace, backup e restauração.
- **Produtividade:** busca global (`Ctrl+K`), envio (`Ctrl+Enter`), nova requisição (`Ctrl+N`), alternância do painel (`Ctrl+\`), geração de cURL com placeholders e guia rápido dentro do app.

## Stack

React + TypeScript + Vite + Tailwind CSS 4. Primitivas acessíveis Radix, componentes locais no padrão shadcn/ui, Lucide e Sonner. `components.json` registra as convenções. Sem CDN, fontes remotas, conta ou telemetria.

O transporte desktop usa os comandos Rust/Tauri. A prévia em navegador faz HTTP real via `fetch`, respeitando CORS e as restrições da plataforma. O servidor de exemplo em `tools/test-server.mjs` só escuta em loopback, tem dados fictícios e permite CORS para validar a interface. POST/PATCH/DELETE são fixtures, não um banco persistente.

`tauri-plugin-window-state` restaura a janela. Mica via `window-vibrancy` é opcional no Windows e tem fallback sólido. A janela tem controles próprios e proteção para alterações não salvas.

## Limites deliberadamente explícitos

| Roadmap | Esta entrega | Ainda necessário |
| --- | --- | --- |
| 0.2 | Organização pela UI, rascunhos, workspace JSON v1 com gravação atômica e exportação do corpo inteiro por streaming no Windows. Migração do WebView para JSON confirmada no desktop, incluindo leitura após limpar a cópia antiga no perfil de teste | Regressão com coleção real durante a validação da 1.0 |
| 0.3 | Ambientes, precedência, captura por rodada, cofre de credenciais no Windows e origem das variáveis no editor. Rodadas em dois ambientes validadas no navegador. No desktop, dois segredos distintos foram recuperados com máscara após reabrir o app e ficaram fora do JSON | Regressão com coleção real durante a validação da 1.0 |
| 0.4 | Parâmetros de caminho e query, autorização herdada ou própria, headers repetidos, validação de JSON, uploads por streaming e timeout e redirecionamentos por endpoint. Rede validada no desktop com destino de outra origem e certificado não confiável | Regressão com coleção real durante a validação da 1.0 |
| 0.5 | Runner sequencial por escopo, testes, extrações, progresso por etapa, resumo parcial ao cancelar e opção de parar na primeira falha. Progresso, cancelamento e política de falha validados no desktop | Regressão com coleção real durante a validação da 1.0 |
| 1.0 | Migração Postman e cURL validada no desktop contra servidor local, importação e backup Fedexe, instalador NSIS x64, atualização local com workspace preservado e primeira medição do Fedexe | Validação com coleção real em outra máquina, publicação no GitHub, comparação com Postman e Yaak e auditoria de acessibilidade |

No desktop, o Fedexe guarda no Gerenciador de Credenciais do Windows os valores literais dos campos de autorização, os valores marcados como secretos e os valores de headers, parâmetros e variáveis reconhecidos como credenciais. Variáveis usadas nesses campos também são tratadas como secretas. Na prévia web, os valores ficam no armazenamento da sessão. Ao abrir um workspace v1 antigo, o app recupera os segredos existentes e migra os valores que antes estavam no JSON durante o próximo salvamento. O JSON salvo e os arquivos exportados preservam a estrutura. Referências de autorização como `{{token}}` continuam disponíveis para configurar as credenciais no destino.

O salvamento automático grava novas versões das credenciais antes de substituir o JSON. Se o cofre ou a gravação do JSON falhar, reabrir o app recupera o último workspace confirmado. Com o app aberto, o botão **Tentar salvar novamente** salva as alterações pendentes. O app limpa as credenciais substituídas depois de confirmar o JSON. Se a limpeza falhar, o workspace salvo continua disponível e a limpeza é retomada no próximo salvamento.

Ao compartilhar, revise texto livre, como descrições e corpos de requisição, e use variáveis marcadas como secretas para inserir credenciais nesses campos. As exportações de configuração e os exemplos cURL aplicam as regras acima. O download de uma resposta salva o conteúdo retornado pelo servidor.

O timeout padrão é de 30 segundos. No desktop, o endpoint pode manter a resposta 3xx ou seguir até dez redirecionamentos dentro da origem original (protocolo, host e porta), com validação TLS ativa. Um redirecionamento que exige repetir um corpo transmitido por streaming pode permanecer como resposta 3xx. No navegador, `fetch` pode combinar headers repetidos, bloqueia redirecionamentos e restringe corpos em GET/HEAD. O runner mostra a etapa atual e atualiza resultados e tempos conforme cada etapa termina. O relatório final do desktop está disponível ao concluir a rodada.

## Verificação

O importador converte atribuições simples como `pm.environment.set('token', pm.response.json().token);` em extrações do runner. O valor extraído fica disponível nas etapas seguintes da rodada. O ambiente salvo mantém seus valores.

Na versão publicada 1.0.0-rc.1, importamos pela interface uma coleção Postman e dois ambientes de teste no mesmo Windows. Cada ambiente apontava para um servidor local distinto, com seu próprio token. A mesma coleção executou três etapas em cada ambiente. O login e a consulta autenticada passaram, e a terceira etapa mostrou “Status esperado 200, recebido 409.” em ambas as execuções. Os logs dos servidores confirmaram a ordem e o destino de cada chamada. A extração usou a forma `pm.collectionVariables.set` compatível com o importador.

Na versão 1.0.0-rc.2, conferimos o SHA-256 do instalador baixado publicamente e repetimos o cenário com o executável extraído do pacote. A coleção usou `pm.environment.set` e passou nas duas primeiras etapas de cada ambiente, com HTTP 409 na terceira etapa intencional. Os dois servidores confirmaram que cada consulta usou o token emitido pelo seu próprio login.

Em um perfil isolado no mesmo Windows, atualizamos da rc.1 para a rc.2 com instaladores NSIS de teste. O SHA-256 do workspace permaneceu igual durante a atualização. Ao abrir a rc.2, a interface carregou a coleção e os dois ambientes gravados antes da atualização.

`npm test` cobre modelos, importação, precedência, persistência segura, montagem de requisições, equivalência editor/runner, HTTP real, extração, isolamento, truncamento e cancelamento. `cargo test --locked --features custom-protocol` mantém o cenário existente de 100 requisições e respostas de 10 MiB.

O teste `console_records_editor_and_runner_requests_without_exposing_credentials` usa um servidor local para verificar sucesso, redirecionamento, timeout, variável ausente e o mascaramento das credenciais e dos valores extraídos nos registros enviados ao console.

Uma execução desktop com duas etapas e servidor local confirmou que a região `role="status"` com `aria-atomic="true"` exibe a segunda etapa em andamento e o resultado e a duração da primeira. Ao cancelar durante a segunda etapa, a região exibiu o cancelamento, uma etapa concluída de duas e o mesmo resultado parcial.

No executável de produção 1.0.0-rc.1, a API Windows UI Automation identificou o botão “Runner de coleções”, informou suporte a foco de teclado e permitiu acioná-lo. A mesma API identificou as caixas de seleção “Coleção”, “Ambiente de execução”, “Escopo da execução” e “Ao encontrar uma falha” como focáveis. No WebView2 de produção, o Playwright confirmou essa sequência com Tab a partir do seletor “Coleção” e verificou `:focus-visible` nos quatro seletores. A tentativa pelo foco global do Windows foi inconclusiva porque outro aplicativo manteve o foco. A leitura falada e o anúncio de atualizações do runner ainda precisam de verificação com o Narrador.

### Importar um workspace do Postman no Windows

1. Abra **Importar → Importar workspace do Postman**.
2. Informe uma chave da API do Postman e selecione **Listar workspaces**. O app valida a chave e a guarda no Gerenciador de Credenciais do Windows. Nas próximas importações, use a chave salva ou informe outra. Use **Remover chave salva** para desconectar.
3. Escolha um workspace. Todas as coleções, ambientes e especificações OpenAPI compatíveis ficam selecionados por padrão. Desmarque os itens que deseja deixar no Postman ou use **Desmarcar todos** para montar a sua seleção.
4. Importe os itens selecionados e revise o relatório. A importação acrescenta cópias ao workspace local. Configure nele os valores secretos e os valores que não foram compartilhados no Postman, selecione um ambiente e execute a coleção.

O relatório aponta itens que falharam no download, recursos sem suporte que o Postman retornou e ajustes detectados durante a conversão, como anexos, exemplos de resposta ou scripts incompatíveis.

### Importar OpenAPI

Em **Importar**, escolha um arquivo OpenAPI 3.0 ou 3.1 em JSON ou YAML, ou cole a especificação. O Fedexe cria uma coleção editável, agrupa as requisições pela primeira tag e cria um ambiente com as URLs dos servidores. Revise as variáveis e preencha os segredos da autenticação antes de enviar as requisições ou executar o runner.

Para OAuth 2.0, configure as credenciais do fluxo importado. Quando uma especificação oferece Client Credentials e Authorization Code, o Fedexe usa Client Credentials se a URL de token for compatível. Authorization Code é configurado para PKCE.

A importação resolve referências internas e converte exemplos de corpo JSON, texto e formulário URL-encoded. O relatório aponta referências externas, URLs relativas, opções adicionais de servidor e recursos que precisam de configuração manual. Ao importar pelo Postman, selecione o ambiente criado para a especificação que deseja executar.

## OAuth 2.0

Em **Autorização**, escolha OAuth 2.0 em uma requisição ou na configuração da coleção. Uma requisição configurada para herdar usa a autorização da coleção.

- **Authorization Code com PKCE**. Registre o Fedexe como cliente público nativo no provedor e permita o retorno para `http://127.0.0.1:<porta>/oauth/callback`, com porta dinâmica. Preencha a URL de autorização, a URL de token, o Client ID e o escopo opcional. Use valores fixos nesses campos. Selecione **Conectar no navegador** e conclua a autorização no navegador padrão do Windows.
- **Client Credentials**. Informe a URL de token, o Client ID, o Client secret e o escopo opcional. Esses campos aceitam variáveis. O Fedexe usa `client_secret_basic` para autenticar no provedor e adquire o token ao enviar ou rodar a requisição. Consulte as instruções da [CLI](CLI.md) para usar esse fluxo em CI.

A sessão PKCE é compartilhada entre configurações com a mesma URL de autorização, URL de token, Client ID e escopo. O Fedexe armazena a sessão no Gerenciador de Credenciais do Windows e tenta renová-la na primeira requisição após a expiração, se houver refresh token. Se o provedor recusá-lo, conecte novamente. Use **Desconectar sessão** com a configuração original para apagar a sessão local. Para revogar a autorização no servidor, use o painel do provedor.

Use HTTPS para o provedor e para as requisições protegidas. Para testes locais, HTTP é aceito em endereços IP de loopback. As exportações preservam a configuração e as referências a variáveis. Sessões e valores de Client secret ficam fora dos arquivos exportados.

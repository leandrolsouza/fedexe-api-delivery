# Roadmap do Fedexe API

O Fedexe é um cliente HTTP desktop para Windows, com armazenamento local, uso sem conta e licença MIT. As integrações externas são opcionais.

O histórico usa as tags do repositório até a `v2.0.1`. A ordem das próximas entregas é uma proposta, sem datas ou versões definidas.

## Entregas por versão

| Versão | Entrega |
| --- | --- |
| 1.0 | Coleções, pastas e requisições salvas localmente, com ordenação, rascunhos e gravação atômica. Editor HTTP com parâmetros, autorização, headers, corpos e download completo no desktop. Ambientes, segredos no cofre do Windows e runner sequencial com validações, extrações e cancelamento. Importação de Postman e cURL, exportação e instalador Windows. |
| 1.1 | Atualizador Windows com pacotes assinados e verificação automática e manual. |
| 1.2 | Inglês por padrão em perfis novos e português do Brasil como preferência local. |
| 1.3 | Runner funcional por CLI para coleções exportadas, com ambientes, validações declarativas, extrações, relatório JSON e códigos de saída para CI. |
| 1.4 | Console desktop com envios do editor e do runner, filtros, diagnóstico e mascaramento de credenciais. |
| 1.5 | Importação direta de coleções e ambientes de workspaces do Postman, com seleção de itens e relatório de ajustes. |
| 1.6 | OAuth 2.0 com Authorization Code e PKCE no desktop e Client Credentials no desktop e na CLI. |
| 1.7 | Importação de OpenAPI 3.0 e 3.1 em JSON e YAML por arquivo, texto ou workspace do Postman. Gera coleções editáveis e ambientes. |
| 1.8 | Backup e restauração opcionais no Google Drive, com segredos fora dos arquivos, e central de notificações. |
| 1.9 | Scripts JavaScript de pré-requisição e pós-resposta no editor e no runner da interface, com importação de scripts Postman compatíveis. O runner ganhou iterações e intervalo entre requisições. A integração com Google Drive passou a ficar desativada nos builds padrão. |
| 2.0 | Testes de carga no desktop e na CLI, com usuários virtuais, perfis de execução, métricas de latência e erro, cancelamento e limites para CI. |
| 2.0.1 | Ajustes visuais nos seletores e menus para os temas claro e escuro. |

Consulte o [guia da interface](docs/INTERFACE.md), o [guia da CLI](docs/CLI.md) e o [benchmark](docs/BENCHMARK.md) para os fluxos disponíveis e as verificações registradas.

## Próximas entregas propostas

### 1. Validar recuperação, atualização, importação e desempenho

- Simular falhas na gravação do workspace e no cofre de credenciais. Confirmar que, ao reabrir, o Fedexe recupera a última versão salva. Exportar e restaurar uma cópia com requisições, ambientes e anexos e documentar as credenciais e os arquivos que precisam ser configurados novamente.
- Validar a atualização em outra máquina Windows com uma coleção representativa, dois ambientes e credenciais no cofre.
- Revisar a importação de anexos do Postman e do cURL. Identificar a requisição ou parte que precisa de arquivo e encaminhar ao editor. Conferir se a prévia web explica as limitações de multipart, binário, download e redirecionamento antes do uso.
- Repetir o benchmark no build de produção e registrar duração, memória e cancelamento em relação ao baseline. Exportar um cenário de carga do desktop e executá-lo pela CLI contra o mesmo servidor de teste. Conferir perfil, limites, diagnóstico do limite excedido, código de saída para CI, isolamento de variáveis por usuário virtual e resumo parcial ao cancelar.

### 2. Levar coleções versionadas ao desktop e à CLI

- Abrir e editar coleções em uma pasta local versionada com Git, com arquivos separados para requisições e ambientes. Preservar a ordem de execução e avisar sobre alterações externas antes de sobrescrever arquivos.
- Executar a coleção diretamente da pasta pela CLI e manter os valores secretos fora dos arquivos versionados.
- Validar o fluxo a partir de um clone, com os mesmos testes e ordem no desktop e na CLI. Editar uma requisição deve produzir um diff localizado.

### 3. Completar o suporte a scripts na execução funcional

- Estender à CLI os scripts de pré-requisição e pós-resposta já disponíveis na interface. A CLI funcional hoje executa validações e extrações declarativas.
- Definir autorização explícita para scripts importados, limites de execução e diagnóstico nos relatórios. Documentar o subconjunto da API Postman, incluindo as chamadas HTTP disponíveis via `pm.sendRequest`.
- Validar os mesmos resultados no desktop e na CLI e verificar que erros e limites aparecem no relatório sem expor credenciais.

### 4. Adicionar proxy por ambiente e mTLS

- Configurar proxy por ambiente e associar certificados de cliente a destinos explícitos, com validação TLS ativa. Documentar a configuração no desktop e na CLI.
- Validar dois ambientes com configurações distintas, falhas de proxy e certificado e redirecionamentos para outro destino. Confirmar no servidor o certificado recebido e verificar o fluxo de conexão direta.

## Backlog sem versão definida

| Candidato | Condição para avançar |
| --- | --- |
| Sincronização com Google Drive | Validar backup e restauração em dois builds com a integração habilitada. Cobrir uso offline, histórico de versões, conflitos sem perda de dados e arquivos sem segredos. |
| Cobertura adicional da migração Postman | Avaliar exemplos de resposta, mocks, monitores e flows conforme a disponibilidade na API e os casos de uso do Fedexe. |
| GraphQL sobre HTTP | Avaliar editor para consultas, mutations e variáveis, além de validação de erros GraphQL no desktop e na CLI. |
| Paralelismo entre etapas | Avaliar dependências explícitas, limites de concorrência, conflitos de variáveis e cancelamento. A execução sequencial segue como padrão. |
| WebSocket e gRPC | Avaliar separadamente a partir de casos de uso para conexões e fluxos de mensagens. |

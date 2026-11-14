# Roadmap do Fedexe API

A versão 1.0 deve permitir organizar APIs em coleções locais, alternar entre dev e homologação, configurar cada endpoint e executar uma suíte de testes inteira. O app roda no Windows, funciona sem conta e permanece gratuito sob licença MIT.

O protótipo já envia requisições HTTP e executa coleções JSON em sequência. O teste atual cobre 100 requisições, extração de token e respostas grandes. A primeira entrega transforma esse fluxo em algo que se pode salvar, editar e reutilizar.

## 0.2 — Coleções e endpoints salvos

- Criar, renomear, duplicar, mover e excluir coleções, pastas e requisições. Permitir reordenar os itens na ordem em que o runner deve executá-los.
- Salvar coleções localmente em JSON versionado, com gravação atômica. Sinalizar alterações pendentes e testar a leitura de arquivos de versões anteriores.
- Editar método e URL. Mostrar status, duração, tamanho, headers e prévia da resposta. Permitir copiar a prévia e salvar o corpo completo em disco por streaming.
- Usar a mesma representação de requisição no editor e no runner.

**Pronto quando** for possível montar uma coleção pela interface, fechar o app, reabrir e executar as requisições salvas.

## 0.3 — Ambientes e segredos

- Criar, duplicar e editar ambientes como Local, Dev e Homologação. Mostrar o ambiente ativo no editor e pedir a seleção no runner antes de executar.
- Resolver `{{variavel}}` em URLs, parâmetros, valores de headers, autorização e corpo. Em caso de conflito, usar esta precedência, da maior para a menor: variáveis temporárias extraídas durante a execução, ambiente selecionado, coleção. Indicar a origem do valor e apontar variáveis ausentes antes de enviar a requisição que depende delas.
- Armazenar segredos no cofre de credenciais do sistema. Mascará-los na interface e excluir os valores de exportações e diagnósticos. Ao trocar de ambiente, carregar os segredos daquele ambiente.
- Capturar o ambiente no início da rodada. Manter tokens e demais variáveis extraídas isolados entre rodadas.

**Pronto quando** a mesma coleção rodar em Dev e Homologação trocando apenas o ambiente, com valores secretos fora dos arquivos exportados.

## 0.4 — Editor completo de endpoints

| Área | Entrega |
| --- | --- |
| Parâmetros | Editar parâmetros de caminho e query. Permitir chaves repetidas e ativar ou desativar linhas. Sincronizar a query da URL com a tabela e aplicar a codificação adequada. |
| Autorização | Herança da coleção, sem autorização, Basic, Bearer e API key via header ou query. Permitir sobrescrever a configuração por endpoint e sinalizar colisões com headers manuais. |
| Headers | Editor de chave e valor com linhas ativáveis e suporte a nomes repetidos. Mostrar quais headers foram gerados pelo app e mascarar valores secretos. |
| Corpo | Sem corpo, JSON ou texto bruto, formulário URL-encoded, multipart com campos e arquivos, e arquivo binário. Validar JSON antes do envio e transmitir arquivos por streaming. |
| Rede | Timeout e política de redirecionamento por endpoint. Manter validação TLS ativa e evitar o reenvio automático de credenciais para outra origem. |

**Pronto quando** o editor e o runner enviarem a mesma requisição efetiva com as mesmas configurações e ambiente, comprovado contra um servidor HTTP controlado.

## 0.5 — Runner de coleções

- Executar coleção inteira, pasta ou requisições selecionadas, em ordem, com ambiente explícito e execução sequencial por padrão.
- Configurar testes declarativos de status, presença ou valor de header e campos JSON. Extrair valores por JSON Pointer e reutilizá-los nas etapas seguintes.
- Exibir progresso, aprovações, falhas e tempos por etapa. Oferecer cancelamento e escolha entre parar na primeira falha ou continuar. Preservar o resumo das etapas concluídas ao cancelar.
- Mostrar falhas de rede, de validação e de resolução de variáveis. Suportar etapas com respostas grandes sem guardar todos os corpos em memória.

**Pronto quando** uma coleção com login, reutilização de token e falhas intencionais puder ser executada e diagnosticada pela interface.

## 1.0 — Migração, distribuição e desempenho

- Importar coleções e ambientes do Postman e importar uma requisição por cURL. Exibir um relatório para itens e recursos que exigem ajustes após a importação.
- Exportar coleções e a estrutura dos ambientes para compartilhamento e backup. Testar importação, exportação e reimportação sem perda dos campos suportados.
- Distribuir um instalador Windows via GitHub Releases e validar instalação e atualização com dados existentes. Verificar teclado, foco e legibilidade da interface.
- Medir o build de produção na mesma máquina e com a mesma coleção usada como referência no Postman e no Yaak. Registrar tempo de abertura, memória privada em repouso e pico com os processos do WebView2, tempo total do runner, latência de cancelamento e memória retida entre rodadas. Usar 100 requisições com autenticação encadeada e algumas respostas de 10 MiB. Registrar o primeiro baseline antes de definir metas numéricas de lançamento.

**Pronto quando** for possível instalar o app em outra máquina, importar uma coleção real, configurar dois ambientes, rodar a suíte e entender as falhas pela interface. A release deve publicar os resultados do benchmark com o cenário usado.

## Depois da 1.0.0

A referência é a tag `v1.0.0`. As versões abaixo indicam a ordem proposta, sem datas fixas. A prioridade é melhorar o fluxo HTTP no Windows, mantendo os dados locais, o uso sem conta e a licença MIT.

### 1.0.x — Estabilidade e atualização

- Priorizar correções de perda de dados, falhas na atualização, regressões de importação e erros no runner. Repetir o teste de atualização a partir da 1.0.0 em outro Windows, com uma coleção representativa, dois ambientes e segredos no cofre.
- Validar com teclado e Narrador os fluxos de edição e execução: foco, anúncios de progresso, falha e cancelamento.
- Revisar os fluxos já expostos na interface. Ao importar Postman ou cURL com anexos, indicar qual requisição ou parte precisa de um arquivo e levar o usuário ao editor para selecioná-lo. Na prévia web, sinalizar antes do envio que multipart e binário exigem o desktop e que o download da resposta salva apenas a prévia. O seletor de redirecionamentos já desabilita o modo de mesma origem na web. Manter essa distinção clara também para requisições importadas.
- Repetir o [benchmark](docs/BENCHMARK.md) no build de produção e na mesma máquina de referência. Comparar tempo de execução, memória privada e cancelamento com o baseline documentado e investigar regressões reproduzíveis.

**Pronto quando** a atualização preservar o workspace e os segredos continuarem acessíveis no cofre, a coleção executar nos dois ambientes, o relatório de importação indicar como concluir a configuração dos anexos e os resultados das verificações de acessibilidade e desempenho estiverem registrados.

### 1.1 — Atualizador no Windows

- Verificar novas versões estáveis ao abrir o app e oferecer uma verificação manual em Configurações. Mostrar a versão disponível e permitir instalar ou adiar.
- Baixar o pacote pelo GitHub Releases, validar a assinatura antes de instalar e preservar o workspace e o acesso aos segredos no cofre.
- Destacar no README e nas notas da 1.1 que quem está na série 1.0.x precisa baixar e instalar a 1.1 manualmente. Adicionar um aviso com link para a 1.1 na página da release 1.0.0 quando a nova versão estiver disponível.

**Pronto quando** a instalação manual sobre uma versão anterior preservar os dados e o app concluir uma atualização entre dois builds assinados. Conferir que o pacote com assinatura inválida é recusado, que adiar mantém a sessão aberta e que o workspace e o cofre continuam disponíveis depois da instalação.

### 1.2 — Inglês como idioma padrão

- Abrir em inglês em instalações novas e quando o perfil não tiver preferência salva. Oferecer português do Brasil em Configurações e guardar a escolha localmente.
- Traduzir menus, editor, runner, diálogos, mensagens de erro e textos acessíveis. Formatar datas e números de acordo com o idioma escolhido. Preservar os nomes e textos das coleções do usuário.

**Pronto quando** um perfil novo abrir em inglês, os fluxos principais funcionarem nos dois idiomas e a escolha de português persistir após reabrir o app.

### 1.3 — Runner por CLI para CI

- Rodar uma coleção exportada, ou uma pasta, no Windows sem abrir a interface. Exigir ambiente explícito e manter ordem sequencial, testes declarativos, extrações e opção de parar na primeira falha.
- Compartilhar a lógica de execução do desktop. Aceitar segredos via variáveis de ambiente do processo, documentar a precedência e mascarar valores nas mensagens e nos relatórios.
- Entregar saída legível, relatório JSON e códigos de saída distintos para sucesso, falha de teste e erro de configuração ou execução. Documentar um exemplo de GitHub Actions.

**Pronto quando** uma pipeline Windows executar a mesma coleção que o desktop, reutilizar o token extraído do login e falhar com o código esperado quando uma validação for quebrada de propósito, sem expor os valores secretos nas saídas do cenário.

### 1.4 — OAuth 2.0

- Começar com Authorization Code com PKCE no navegador do sistema e Client Credentials. Definir suporte por cliente: PKCE no desktop e Client Credentials no desktop e na CLI.
- Guardar tokens persistidos no cofre do Windows e prever expiração, renovação quando disponível e limpeza ao desconectar. Documentar a configuração de credenciais em CI.

**Pronto quando** o desktop autenticar contra um provedor de teste e reutilizar a sessão com renovação quando aplicável, e a CLI executar Client Credentials sem interação. Os testes devem cobrir falha de autenticação e conferir que tokens não aparecem nas exportações nem nos relatórios.

### 1.5 — Proxy e certificados de cliente

- Configurar proxy por ambiente e associar certificados de cliente a destinos explícitos para autenticação mTLS. Manter a validação TLS e documentar como fornecer credenciais e certificados no desktop e na CLI.
- Validar troca de ambiente, diagnóstico de proxy e certificado inválido, além dos casos em que um redirecionamento tenta mudar de destino.

**Pronto quando** a mesma coleção executar em dois ambientes de teste com configurações distintas de proxy e mTLS, com confirmação no servidor de que cada destino recebeu o certificado esperado e de que o tráfego direto continua funcionando.

### 1.6 — Testes de carga

- Criar um modo de carga para repetir uma coleção ou pasta em ambientes de teste. Permitir configurar usuários virtuais, duração, subida gradual e um limite global de requisições por segundo. Mostrar o ambiente e os destinos antes de iniciar e oferecer cancelamento durante a rodada.
- Executar os passos da coleção em ordem para cada usuário virtual, com tokens e variáveis extraídos isolados entre usuários. Reaproveitar as validações do runner e agregar as métricas sem guardar todos os corpos de resposta.
- Mostrar volume de requisições por segundo, taxa de erros e latências p50, p95 e p99 por endpoint, com contagem de amostras. Exportar o resumo em JSON. Permitir definir limites de aprovação para p95 e taxa de erros e usar o resultado na CLI para CI.

**Pronto quando** um cenário local com login, respostas lentas e falhas intencionais confirmar a ordem dos passos e o isolamento dos tokens por usuário. O relatório deve refletir os resultados observados no servidor, a CLI deve sinalizar limites excedidos e o cancelamento deve interromper a carga e preservar o resumo parcial.

### Backlog sem versão definida

| Candidato | Condição para entrar no roadmap |
| --- | --- |
| Scripts JavaScript | Definir permissões, isolamento e limites de CPU e memória. Começar por testes e extrações que as regras declarativas não cobrem. |
| Paralelismo entre etapas da mesma coleção | Modelar dependências explícitas, conflitos de variáveis e cancelamento. Preservar a execução sequencial por padrão. |
| GraphQL | Priorizar consultas e mutations sobre HTTP, se houver demanda por editor e variáveis próprios. |
| WebSocket e gRPC | Avaliar separadamente, com casos de uso que justifiquem o suporte a conexões e fluxos de mensagens. |

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

## Depois da 1.0

OAuth 2.0, certificados de cliente, proxy por ambiente, scripts JavaScript com isolamento, runner via CLI para CI, paralelismo com dependências explícitas, GraphQL, WebSocket e gRPC.

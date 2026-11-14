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

Segredos de ambiente ficam fora do JSON local. Exportações e backups omitem valores de headers e variáveis marcados como secretos, preservando a estrutura dessas linhas. Headers literais continuam no workspace local. Para guardar o valor no cofre, use uma variável de ambiente com cadeado e referencie-a no header. Revise também credenciais literais presentes em autorização, corpo e URLs antes de compartilhar.

O timeout padrão é de 30 segundos. No desktop, o endpoint pode manter a resposta 3xx ou seguir até dez redirecionamentos dentro da origem original (protocolo, host e porta), com validação TLS ativa. Um redirecionamento que exige repetir um corpo transmitido por streaming pode permanecer como resposta 3xx. No navegador, `fetch` pode combinar headers repetidos, bloqueia redirecionamentos e restringe corpos em GET/HEAD. O runner mostra a etapa atual e atualiza resultados e tempos conforme cada etapa termina. O relatório final do desktop está disponível ao concluir a rodada.

## Verificação

`npm test` cobre modelos, importação, precedência, persistência segura, montagem de requisições, equivalência editor/runner, HTTP real, extração, isolamento, truncamento e cancelamento. `cargo test --locked --features custom-protocol` mantém o cenário existente de 100 requisições e respostas de 10 MiB.

Uma execução desktop com duas etapas e servidor local confirmou que a região `role="status"` com `aria-atomic="true"` exibe a segunda etapa em andamento e o resultado e a duração da primeira. Ao cancelar durante a segunda etapa, a região exibiu o cancelamento, uma etapa concluída de duas e o mesmo resultado parcial.

No executável de produção 1.0.0-rc.1, a API Windows UI Automation identificou o botão “Runner de coleções”, informou suporte a foco de teclado e permitiu acioná-lo. A mesma API identificou as caixas de seleção “Coleção”, “Ambiente de execução”, “Escopo da execução” e “Ao encontrar uma falha” como focáveis. No WebView2 de produção, o Playwright confirmou essa sequência com Tab a partir do seletor “Coleção” e verificou `:focus-visible` nos quatro seletores. A tentativa pelo foco global do Windows foi inconclusiva porque outro aplicativo manteve o foco. A leitura falada e o anúncio de atualizações do runner ainda precisam de verificação com o Narrador.

# Como criar interfaces com a mesma lógica do Fedexe

> Replicar a qualidade da experiência, não copiar a aparência.

Este guia explica as decisões por trás da interface do Fedexe e como aplicar esse raciocínio em outros produtos. Não é um manual para repetir a cor violeta, a barra lateral, as abas ou os mesmos componentes.

A ideia central é:

**Entender o trabalho do usuário → organizar a complexidade → destacar o próximo passo → mostrar o que aconteceu → facilitar a repetição.**

Um aplicativo financeiro, um gerenciador de arquivos e uma ferramenta de desenvolvimento podem usar esse mesmo princípio e ter aparências completamente diferentes.

Para conhecer os recursos e o comportamento específicos do Fedexe, consulte [INTERFACE.md](INTERFACE.md). Este documento trata do método de concepção.

## 1. Começar pelo trabalho, não pelo template

No Fedexe, o ponto de partida foi o roadmap. Ele descrevia alguém organizando e testando APIs, não alguém acompanhando indicadores de negócio. Por isso, uma tela de trabalho fazia mais sentido que um dashboard genérico.

O fluxo principal foi resumido assim:

**Organizar → configurar → enviar → validar → repetir.**

Essa sequência orientou a navegação, os controles e a posição da resposta.

### Como aplicar em outro app

Antes de desenhar, responda:

1. Quem usa o produto e em qual contexto?
2. Qual resultado essa pessoa quer obter?
3. Que sequência de ações ela repete?
4. De quais informações precisa para decidir o próximo passo?
5. Quais erros custam tempo, dinheiro ou perda de trabalho?

Escreva o fluxo em verbos, não em nomes de telas:

| Produto | Exemplo de fluxo principal |
| --- | --- |
| Atendimento | Encontrar chamado → entender contexto → responder → resolver |
| Estoque | Encontrar produto → conferir saldo → registrar movimentação → verificar resultado |
| Financeiro | Identificar pendência → conferir lançamento → aprovar ou corrigir → conciliar |
| Publicação de conteúdo | Escolher material → editar → revisar → publicar → acompanhar |
| Análise de dados | Formular pergunta → filtrar dados → comparar → decidir |

Um dashboard é adequado quando ajuda a priorizar ou decidir. Ele não precisa existir só porque o aplicativo tem dados.

**Entregável desta etapa:** uma frase sobre o objetivo do produto e uma sequência curta representando seu uso principal.

## 2. Organizar a interface pelo modelo mental do usuário

Pessoas pensam em pedidos, arquivos, clientes, projetos ou requisições. Normalmente não pensam em tabelas de banco, serviços internos ou módulos do backend.

No Fedexe, coleções agrupam requisições; ambientes mudam seu contexto; o editor prepara uma ação; a resposta permite conferir o resultado. A interface aproxima esses conceitos do trabalho real.

### Regra prática

Separe três perguntas:

- **Onde estou?** Produto, projeto, conta, organização ou ambiente atual.
- **Com o que estou trabalhando?** Item selecionado e suas informações.
- **O que posso fazer agora?** Ações relevantes para esse item e esse momento.

Essas respostas precisam estar claras, mas não exigem três painéis.

### Uma organização possível, não obrigatória

| Camada | Responsabilidade | Possíveis formas |
| --- | --- | --- |
| Contexto global | Identificar o espaço de trabalho e configurações que afetam várias ações | Cabeçalho, seletor de organização, identificação de projeto |
| Navegação principal | Trocar entre capacidades do produto | Menu, barra lateral, navegação superior ou inferior |
| Navegação contextual | Encontrar e selecionar os itens de uma capacidade | Lista, árvore, busca, fila, calendário |
| Área de trabalho | Executar a tarefa principal | Editor, formulário, tabela, documento, mapa |
| Resultado e feedback | Entender o efeito das ações | Prévia, atualização da lista, resumo, mensagem de estado |

Uma lista simples pode precisar de apenas duas dessas regiões. Uma ferramenta de edição complexa pode precisar de todas.

**Não copie a quantidade de painéis do Fedexe. Copie a clareza das responsabilidades.**

## 3. Priorizar o próximo passo

Uma boa tela não dá o mesmo destaque a todas as possibilidades.

No Fedexe, método e URL ficam próximos de **Enviar**. A resposta aparece no mesmo contexto. Configurações menos frequentes não disputam atenção com esse caminho.

### Distribua as ações por importância

- **Principal:** produz o avanço mais esperado naquele contexto.
- **Secundária:** ajuda a preparar, revisar ou complementar esse avanço.
- **Contextual:** pertence a um item específico, como renomear ou duplicar.
- **Destrutiva:** exige cuidado proporcional ao impacto, como excluir dados.

Use destaque com intenção. A regra não é “um único botão colorido em todo o aplicativo”, mas **evitar ações concorrentes com o mesmo peso sem necessidade**.

Pergunte ao olhar uma tela:

> Em poucos segundos, uma pessoa consegue identificar o item atual, a ação principal e onde verá o resultado?

Se não conseguir, reveja a hierarquia antes de adicionar efeitos visuais.

## 4. Revelar complexidade conforme a necessidade

Uma ferramenta pode ser poderosa sem exibir todos os controles simultaneamente.

No Fedexe, parâmetros, autorização, corpo e testes pertencem à mesma requisição, mas são separados em grupos. A pessoa encontra a complexidade quando precisa dela.

### Formas de fazer isso

- Manter o caminho comum visível.
- Separar opções avançadas de opções frequentes.
- Colocar ações de um item perto dele.
- Explicar configurações no ponto de uso.
- Oferecer busca quando navegar manualmente deixa de ser eficiente.

### Como escolher o padrão

| Situação | Padrão que pode ajudar |
| --- | --- |
| Alternar entre aspectos independentes do mesmo objeto | Abas |
| Preencher etapas que dependem umas das outras | Fluxo guiado por etapas |
| Consultar detalhes opcionais | Seção expansível |
| Fazer uma decisão curta e delimitada | Diálogo |
| Trabalhar longamente em algo | Tela ou área de trabalho persistente |
| Executar ações pouco frequentes de um item | Menu contextual |

Não esconda informação que precisa ser comparada simultaneamente. Não transforme tarefas longas em uma sequência de pequenos modais.

## 5. Aproximar preparação, ação e resultado

Parte da sensação de fluidez vem de não obrigar a pessoa a reconstruir o contexto depois de cada ação.

No Fedexe, a configuração da requisição e sua resposta pertencem à mesma área de trabalho. Isso favorece um ciclo curto: ajustar, executar, observar e ajustar novamente.

Em outros produtos:

- Um editor pode manter a prévia próxima do conteúdo.
- Uma movimentação de estoque pode mostrar o saldo resultante.
- Uma importação pode terminar com itens importados, rejeitados e motivos.
- Uma aprovação pode atualizar o estado do item e registrar a decisão.

O resultado não precisa aparecer em um painel separado. Pode ser uma alteração clara na própria tela.

**O importante é fechar o ciclo da ação, e não apenas mostrar uma notificação de sucesso.**

## 6. Projetar estados, não apenas a tela preenchida

Uma interface não está completa porque fica bonita com dados de exemplo.

Para cada fluxo relevante, considere:

| Estado | O que a interface deve responder |
| --- | --- |
| Primeira utilização | O que este espaço faz e como começar? |
| Lista vazia | Ainda não há dados, houve um erro ou o filtro não encontrou nada? |
| Edição pendente | O que mudou e o que já foi salvo? |
| Carregamento | O que está acontecendo e ainda posso interagir? |
| Sucesso | O que foi concluído e qual é o resultado? |
| Erro de validação | Qual campo precisa de correção e como corrigir? |
| Erro de execução | O que falhou e quais são as opções de recuperação? |
| Resultado parcial | O que terminou, o que falhou e o que não foi executado? |
| Cancelamento | O que foi interrompido e o que permanece válido? |
| Falta de permissão ou indisponibilidade | Por que não posso continuar e o que posso fazer? |

Não use uma mensagem genérica para situações diferentes.

**Pouco útil:** “Ocorreu um erro.”

**Mais útil:** “Não foi possível salvar. Suas alterações continuam abertas. Tente novamente ou exporte uma cópia.”

Essa mensagem só é correta se as alterações realmente estiverem preservadas e a exportação estiver disponível.

### Honestidade faz parte do design

- Não invente progresso quando o sistema só informa que está trabalhando.
- Não informe “salvo” antes de confirmar a gravação.
- Não afirme que cancelar desfaz operações já concluídas.
- Diferencie dados de demonstração de resultados reais.
- Não apresente proteção de dados que a implementação ainda não oferece.
- Quando houver diferenças entre web e desktop, explique as consequências relevantes.

Um recurso planejado pode ser omitido ou identificado como indisponível. Não precisa virar um botão decorativo.

## 7. Preservar o trabalho e reduzir ações repetidas

Uma interface de produtividade demonstra cuidado quando respeita o esforço já investido.

No Fedexe, rascunhos, abas, histórico, busca e atalhos ajudam a retomar e repetir tarefas. O valor está nessa continuidade, não na presença desses componentes por si só.

### Escolha conforme o produto

- Preserve filtros quando a pessoa abre um item e volta à lista.
- Evite perder edição ao mudar de contexto.
- Deixe claro se o salvamento é automático ou manual.
- Não use as palavras “rascunho”, “salvo” e “publicado” como sinônimos.
- Ofereça duplicação quando criar itens parecidos for uma tarefa comum.
- Use desfazer quando for viável e seguro.
- Confirme operações de alto impacto, não cada clique rotineiro.
- Disponibilize atalhos sem tornar o mouse ou a descoberta visual dispensáveis.

Antes de adotar abas, pergunte se as pessoas realmente alternam entre vários itens em andamento. Caso contrário, uma navegação simples pode ser melhor.

## 8. Criar coerência visual sem impor uma identidade

A aparência ajuda quando torna a estrutura mais compreensível.

O que vale replicar é o sistema de relações:

- Elementos parecidos se comportam de forma parecida.
- Itens relacionados ficam próximos.
- Títulos, conteúdo e informações auxiliares têm pesos distintos.
- Ações principais se destacam sem dominar toda a tela.
- Separações e superfícies ajudam a entender os grupos.
- A densidade permite trabalhar sem prejudicar a leitura.

### Defina papéis antes de valores

Em vez de começar por um catálogo de cores e sombras, defina funções:

| Papel | Pergunta que ele resolve |
| --- | --- |
| Fundo da aplicação | Onde está o espaço geral? |
| Superfície de trabalho | Onde começa um grupo ou tarefa? |
| Texto principal | O que preciso ler primeiro? |
| Texto auxiliar | Que contexto complementa a informação? |
| Destaque de ação | Onde está a ação prioritária? |
| Estado semântico | Isto indica sucesso, atenção, erro ou informação? |
| Borda e separação | Que elementos pertencem ao mesmo conjunto? |

Depois escolha cores, tipografia, espaçamentos e formas compatíveis com a identidade de cada app. Registre essas escolhas em tokens compartilhados, em vez de decidir valores isolados em cada componente.

### O que não precisa ser herdado

- Violeta, tema claro ou qualquer paleta específica.
- A mesma fonte, os mesmos raios de borda e as mesmas sombras.
- Uma barra lateral estreita com ícones.
- Cards de métricas, árvores de pastas ou abas.
- Ilustrações, slogans e textos de personalidade.
- A política local-first: ela deve corresponder aos requisitos reais do produto.

**Consistência de experiência não significa uniformidade de aparência.**

## 9. Tratar acessibilidade e adaptação como fundamentos

Uma tela não deve depender de cor, precisão do mouse ou visão perfeita para funcionar.

Desde o início:

- Use controles semânticos e nomes acessíveis.
- Garanta foco visível e navegação por teclado.
- Não comunique estados apenas por cor: acrescente texto ou outro sinal.
- Confira contraste, inclusive em textos auxiliares e temas alternativos.
- Evite fontes muito pequenas para acomodar informação demais.
- Faça erros e mudanças importantes serem anunciáveis por tecnologias assistivas.
- Respeite preferências de movimento reduzido.
- Mantenha ações importantes utilizáveis com zoom e em janelas menores.

Como referência, WCAG 2.2 AA pede contraste de pelo menos 4,5:1 para texto comum e 3:1 para texto grande. Alvos de interação devem atender ao critério de tamanho mínimo de 24 × 24 CSS px ou suas exceções; em interfaces de toque, prefira áreas maiores, como 44 × 44.

Adaptação não é simplesmente encolher a tela desktop:

- Reorganize ou recolha regiões auxiliares.
- Preserve o contexto que evita erros.
- Mantenha a ação principal fácil de encontrar.
- Use rolagem localizada quando tabelas ou código realmente precisarem.
- Reavalie a densidade em vez de reduzir toda a tipografia.

Auditorias automáticas ajudam, mas não substituem testes com teclado, leitor de tela e pessoas reais.

## 10. Separar a experiência da tecnologia

No Fedexe, React e TypeScript estruturam a interface; Tailwind e CSS organizam estilos; primitivas Radix e componentes no padrão shadcn/ui apoiam comportamentos reutilizáveis; Tauri conecta a interface ao desktop.

Essas ferramentas viabilizam a implementação. **Elas não criam, sozinhas, a clareza do produto.**

O mesmo raciocínio pode ser usado em Vue, Angular, Flutter, aplicações nativas ou páginas renderizadas no servidor.

Na implementação, procure separar:

1. **Componentes básicos:** botões, campos, diálogos e menus consistentes.
2. **Componentes de tarefa:** editor, fila, comparação ou formulário do domínio.
3. **Estado da interface:** seleção, filtros, painéis e diálogos abertos.
4. **Estado do trabalho:** rascunhos, alterações pendentes e operações em andamento.
5. **Dados e regras do domínio:** entidades, validação e permissões.
6. **Integrações:** armazenamento, rede e recursos da plataforma.

O desenho exato das pastas pode variar. O objetivo é evitar que a aparência, a regra de negócio e o acesso a dados fiquem inseparáveis.

Quando houver web e desktop, mantenha a intenção da experiência, mas não esconda limitações da plataforma nem prometa comportamentos idênticos sem validação.

## 11. Um processo reutilizável de construção

### Etapa 1 — Ler o produto

Analise o roadmap, a implementação existente e as restrições. Separe o que já funciona do que é apenas intenção.

**Saída:** objetivo principal, usuários, entidades e limitações conhecidas.

### Etapa 2 — Desenhar o fluxo essencial

Escreva a sequência principal e identifique decisões e riscos.

**Saída:** um caminho completo que começa com uma necessidade e termina com um resultado verificável.

### Etapa 3 — Distribuir as responsabilidades

Defina como a pessoa encontra o item, entende o contexto, age e confere o resultado. Só então escolha menus, listas, painéis ou abas.

**Saída:** estrutura da navegação e das telas, ainda sem depender de acabamento visual.

### Etapa 4 — Definir hierarquia e estados

Escolha as ações prioritárias e descreva estados vazios, edição, execução, falha e recuperação.

**Saída:** comportamento esperado, não apenas uma imagem da tela ideal.

### Etapa 5 — Criar uma linguagem visual pequena

Defina tokens e componentes básicos suficientes para manter coerência. Ajuste a identidade ao produto.

**Saída:** regras de tipografia, espaçamento, superfícies, ações e estados.

### Etapa 6 — Implementar um fluxo completo real

Faça uma tarefa funcionar de ponta a ponta, incluindo persistência ou integração quando necessárias. Use esse fluxo para validar o padrão antes de expandir o restante.

**Saída:** uma experiência utilizável, sem depender de sucesso simulado.

### Etapa 7 — Expandir sem perder coerência

Reutilize comportamentos e componentes. Permita exceções justificadas por tarefas diferentes; nem toda tela precisa ter a mesma composição.

**Saída:** conjunto de funcionalidades com uma linguagem comum.

### Etapa 8 — Revisar no uso real

Teste dados longos, listas vazias, falhas, retorno à tela anterior, múltiplas edições, teclado, zoom e tamanhos de janela.

**Saída:** ajustes orientados por problemas observados, não apenas por preferência estética.

## 12. Perguntas para revisar uma interface

### Clareza

- [ ] A tela deixa claro onde a pessoa está e com qual item está trabalhando?
- [ ] A tarefa principal é reconhecível sem explicação externa?
- [ ] As ações usam a linguagem do domínio, não a estrutura técnica do sistema?
- [ ] A interface evita competir por atenção com a própria tarefa?

### Continuidade

- [ ] A ação produz um resultado compreensível no contexto?
- [ ] Navegar não descarta trabalho silenciosamente?
- [ ] A pessoa distingue edição pendente de informação confirmada?
- [ ] Tarefas repetidas têm caminhos eficientes?

### Confiança

- [ ] Estados vazios, falhas e cancelamentos foram projetados?
- [ ] Mensagens descrevem o comportamento real da implementação?
- [ ] Operações arriscadas deixam claras suas consequências?
- [ ] Privacidade, salvamento e permissões são explicados de forma correta?

### Uso

- [ ] Textos são legíveis e o contraste é adequado?
- [ ] Há uso completo por teclado e foco visível?
- [ ] A interface funciona com conteúdo real, não só exemplos curtos?
- [ ] Janelas menores preservam as tarefas importantes?
- [ ] Houve validação além de screenshots e auditorias automáticas?

## 13. Briefing para usar em outro projeto

Preencha isto antes de pedir o desenho ou a implementação:

```text
Produto:
Quem usa:
Contexto de uso:
Principal resultado esperado:
Fluxo mais repetido:
Entidades com que a pessoa trabalha:
Informações necessárias antes de agir:
Erros de maior impacto:
O que precisa ser preservado entre ações ou sessões:
Capacidades já existentes:
Limitações atuais:
Plataformas e tamanhos de tela:
Necessidades de acessibilidade:
Tom de comunicação e identidade próprios:
```

### Prompt reutilizável

```text
Analise o roadmap e a implementação deste projeto antes de propor a interface.

Quero uma experiência orientada ao trabalho do usuário, não uma cópia visual
de outro aplicativo nem um dashboard genérico.

1. Identifique o objetivo principal, as entidades e o fluxo mais repetido.
2. Organize a navegação pelo modelo mental do usuário.
3. Deixe claros o contexto atual, a ação principal e seu resultado.
4. Revele complexidade de forma progressiva, sem esconder informação essencial.
5. Preserve o trabalho e reduza o esforço nas tarefas repetidas.
6. Projete estados vazios, carregamento, edição pendente, sucesso, erro,
   cancelamento e recuperação conforme os comportamentos reais do sistema.
7. Crie hierarquia visual e componentes consistentes com a identidade deste
   produto. Não é necessário repetir cores, fontes, barras laterais ou abas.
8. Considere acessibilidade, teclado, zoom, textos longos e janelas menores.
9. Preserve convenções, dados e integrações existentes. Não apresente
   funcionalidades planejadas como se já estivessem funcionando.
10. Implemente e valide primeiro um fluxo completo real; depois expanda
    os padrões que funcionarem.

Antes de implementar, resuma as decisões de organização e explique por que
elas atendem às tarefas deste produto. Depois valide os fluxos implementados,
e não apenas a aparência.

Contexto do meu projeto:
[cole aqui o briefing preenchido]
```

## Em uma frase

**Uma boa interface torna o trabalho compreensível, a ação previsível, o resultado visível e a continuidade segura. A identidade visual deve servir a isso — não substituir isso.**

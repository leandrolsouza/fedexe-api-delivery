# Style Guide do Fedexe API

O editor de requisições é a referência visual do Fedexe API. O cabeçalho identifica a requisição, a barra reúne método, URL e **Enviar**, e os painéis mostram a configuração e a resposta. Claro e escuro compartilham a hierarquia, a tipografia e as medidas. A opção **Sistema** acompanha o tema do sistema operacional.

## Cores

Use as variáveis de `styles.css` de acordo com a função visual. As superfícies e bordas delimitam os painéis. O violeta destaca a ação principal, a seleção e o foco.

| Uso | Variável CSS | Claro | Escuro |
| --- | --- | --- | --- |
| Fundo da área de trabalho | `--canvas` | `#F8F9FC` | `#15151E` |
| Fundo dos painéis e da barra de URL | `--surface` | `#FFFFFF` | `#1C1C28` |
| Fundo discreto, como o contador de aba inativa | `--surface-muted` | `#F5F6FA` | `#22222F` |
| Fundo de ação discreta ao passar o mouse | `--hover` | `#F0F1F7` | `#292936` |
| Texto principal | `--text` | `#303342` | `#D6D6E4` |
| Nome da requisição | `--heading` | `#252638` | `#F0EFF7` |
| Texto de abas inativas e da URL | `--secondary` | `#62677C` | `#A2A1B6` |
| Descrições e métricas | `--muted` | `#62677C` | `#9999B0` |
| Bordas de painéis e divisórias | `--border` | `#E9EAF1` | `#2B2B3A` |
| Borda da barra de URL e da variante contornada | `--border-strong` | `#DEDFEA` | `#3A394D` |
| Fundo de **Enviar**, foco e linha da aba ativa | `--accent` | `#6950D2` | `#A28AFF` |
| Fundo de **Enviar** ao passar o mouse | `--accent-hover` | `#5B43BC` | `#A992FF` |
| Texto e ícone sobre o acento | `--on-accent` | `#FFFFFF` | `#19142A` |
| Fundo da seleção e do botão secundário | `--accent-soft` | `#F0ECFD` | `#2B2345` |
| Texto da aba ativa e do botão secundário | `--accent-text` | `#6950C2` | `#B7A4FF` |
| Salvo, GET e resposta abaixo de 400 | `--green` | `#196E54` | `#5AC59B` |
| Fundo do selo de resposta abaixo de 400 | `--green-bg` | `#EDF8F2` | `#1E332D` |
| Alterações pendentes | `--amber` | `#81591F` | `#E1B56D` |
| Erro HTTP e falha de teste | `--red` | `#A13850` | `#EF8898` |

O selo HTTP combina código numérico e descrição quando disponível. A partir de 400, usa texto vermelho e fundo com 8% de `--red`. A indicação de progresso mantém texto ao lado do ponto de status, como **Aguardando**, **Enviando**, **Recebida** ou **Falhou**. **Enviar** usa a variante primária e dá lugar a **Cancelar**, na variante secundária, durante a execução. A aba ativa combina texto violeta, peso 550 e sublinhado de 2 px. O foco por teclado usa contorno de 3 px com afastamento de 3 px nos controles que seguem a regra geral. A barra de URL também tem tratamento próprio de foco.

### Métodos HTTP

O seletor e a etiqueta de método exibem o nome junto da cor. Os valores abaixo são as cores de texto atuais.

| Método | Claro | Escuro |
| --- | --- | --- |
| GET | `#196E54` | `#5AC59B` |
| POST | `#976B2C` | `#976B2C` |
| PUT | `#3C729F` | `#3C729F` |
| PATCH | `#8653A4` | `#8653A4` |
| DELETE | `#B44860` | `#B44860` |
| HEAD e OPTIONS | `#7F8CBB` | `#7F8CBB` |

## Tipografia

**Inter Variable** é a fonte da interface, com `Segoe UI` e `sans-serif` como alternativas. **IBM Plex Mono** é usada na URL e no visualizador do corpo da resposta, com `Cascadia Code`, `Consolas` e `monospace` como alternativas. As duas fontes principais são empacotadas com o app.

| Elemento | Família | Tamanho e peso na configuração base |
| --- | --- | --- |
| Texto base da aplicação | Inter Variable | 13 px |
| Nome da requisição | Inter Variable | 21 px, peso 600 |
| Descrição da requisição | Inter Variable | 11 px |
| Método HTTP | Inter Variable | 11 px, peso 650 |
| URL | IBM Plex Mono | 12 px, peso 400 |
| Botão **Enviar** | Inter Variable | 11 px, peso 550 |
| Abas da requisição e da resposta | Inter Variable | 11 px e 10 px, respectivamente, peso 450 em repouso e 550 quando ativas |
| Título **Resposta** | Inter Variable | 12 px, peso 550 |
| Corpo da resposta | IBM Plex Mono | 12 px, peso 400, altura de linha `1.9` |

Em janelas estreitas, o editor usa tamanhos menores para preservar espaço. Por exemplo, a partir do breakpoint de até 780 px, o nome usa 17 px e a URL usa 10 px.

## Espaçamentos e bordas

As medidas abaixo partem do layout desktop base, compartilhado pelos dois temas. A largura e a altura da janela podem ajustar os recuos e as dimensões dos controles.

| Elemento | Medidas de referência |
| --- | --- |
| Área do editor | 25 px no topo, 27 px nas laterais e 12 px no rodapé |
| Cabeçalho | 16 px entre o título e o grupo de ações, 13 px entre o ícone e o bloco de título, 22 px abaixo do cabeçalho |
| Barra de comando | 8 px entre linhas e 12 px entre controles na mesma linha, com 10 px abaixo antes dos painéis |
| Barra de URL | Altura mínima de 43 px, preenchimento de 3 px e raio de 7 px |
| Botão **Enviar** | Altura de 35 px, raio de 5 px, preenchimento horizontal de 13 px e intervalo de 8 px entre os elementos |
| Painéis de configuração e resposta | Borda de 1 px e raio de 9 px |
| Abas da requisição | Altura mínima de 42 px, recuo lateral de 20 px e intervalo de 23 px entre abas |
| Conteúdo da configuração | Recuos de 18 px no topo, 20 px nas laterais e 11 px na base |
| Cabeçalho da resposta | Altura de 49 px e recuo lateral de 19 px |
| Separador no modo dividido | Faixa de 12 px com alça visível de 34 × 3 px |

## Ícones

O editor usa `lucide-react`. Os nomes abaixo correspondem aos componentes no código, e os tamanhos indicam o valor passado diretamente ao componente. Os ícones são os mesmos nos dois temas e acompanham a cor do controle ou do estado.

| Elemento | Ícone | Tamanho | Tratamento visual |
| --- | --- | --- | --- |
| Cabeçalho da requisição | `Braces` | 21 px | `--accent` em caixa de 40 × 42 px, com fundo `--surface`, borda `--border` e raio de 10 px |
| Salvar | `Save` | 14 px | Acompanha o texto do botão |
| Método HTTP | `ChevronDown` | 13 px | Acompanha a cor do método selecionado |
| Enviar e cancelar envio | `Send` e `X` | 15 px | Acompanham o texto da variante primária ou secundária |
| Aba Autorização | `LockKeyhole` | 12 px | Acompanha a cor da aba |
| Gerar código cURL | `Code2` | 17 px | `--muted` em repouso e `--accent` ao passar o mouse |
| Tempo e tamanho da resposta | `Clock3` e `Database` | 12 px | `--muted`, junto à respectiva métrica |
| Copiar e baixar a resposta | `Copy` e `ArrowDownToLine` | 15 px | Botões discretos de 30 × 30 px, com rótulos acessíveis |
| Resposta em andamento | `LoaderCircle` | 32 px | Ícone animado acompanhado de texto |
| Falha na requisição | `TriangleAlert` | 24 px | Acompanha o título e a descrição da falha |

Consulte o [CSS da interface](../ui/src/styles.css), o [editor de requisições](../ui/src/components/RequestEditor.tsx) e o [componente de botão](../ui/src/components/ui/button.tsx) para reproduzir os estilos existentes. O [mapa da interface](INTERFACE.md) descreve o fluxo e a navegação do app.

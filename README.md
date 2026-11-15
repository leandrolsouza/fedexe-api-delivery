# Fedexe API

Cliente HTTP desktop local sob licença MIT. Rust + Tauri 2, com interface React, TypeScript, Tailwind CSS e componentes no padrão shadcn/ui. Sem conta e sem serviços de nuvem obrigatórios.

A partir da 1.2, a interface abre em inglês quando o perfil ainda não tem preferência de idioma. Para mudar para português do Brasil, abra **Settings → Interface language** e selecione **Português (Brasil)**. A escolha fica salva no perfil local.

**Vindo da 1.0.x?** Baixe o instalador da [versão 1.1.0](https://github.com/leandrolsouza/fedexe-api-delivery/releases/tag/v1.1.0) e execute-o sobre a instalação existente. A série 1.0.x não tem atualizador. A partir da 1.1, o Fedexe verifica versões estáveis na abertura e em **Settings → Updates** (ou **Configurações → Atualizações** em português).

## Executar

Instale Node.js 22.17+, Rust com o toolchain MSVC, as ferramentas de build C++ da Microsoft e o WebView2.

```powershell
npm ci
npm run tauri dev
```

Para experimentar a coleção **Acme API**, suba `node tools/test-server.mjs` em outro terminal. No app, mantenha o ambiente **Local** e envie **List users**, ou abra o **Collection runner** e execute as 8 etapas. Os usuários são fictícios e alterações no servidor de exemplo não são persistidas. Para testar uma resposta grande, envie GET para `http://127.0.0.1:8787/large`.

### Prévia no navegador

```powershell
npm run dev
```

Abra `http://127.0.0.1:1420`. Os envios são reais via `fetch`, sujeitos a CORS; a versão desktop usa o motor Rust e não tem essa restrição. Coleções, ambientes e configurações ficam no armazenamento local de cada contexto (navegador e desktop não compartilham seus dados).

### Build desktop

```powershell
npm run build
cargo run --release --locked --features custom-protocol
```

Para gerar o instalador Windows por usuário, execute `.\node_modules\.bin\tauri.cmd build --ci -- --locked` no PowerShell. O pacote NSIS fica em `target/release/bundle/nsis`. A versão do instalador vem de `tauri.conf.json`.

Execute manualmente o workflow **Windows installer** no commit da release. Ele confere as versões do Tauri, npm e Cargo, gera o pacote e valida a instalação e a preservação do workspace em outro runner Windows.

Para publicar uma versão estável com o atualizador habilitado, siga o [procedimento de assinatura e publicação](docs/UPDATER.md).

### Validar a instalação em outro Windows

1. Copie o instalador x64 e o arquivo `.sha256` para a máquina de teste. Compare a primeira coluna do arquivo com o resultado de `Get-FileHash -LiteralPath "<instalador.exe>" -Algorithm SHA256`.
2. Instale e abra o Fedexe. Importe uma coleção Postman e dois ambientes de teste. Configure os segredos no app e selecione cada ambiente no runner. Confira se as requisições chegam aos destinos esperados, se o token extraído é usado na etapa seguinte e se uma validação propositalmente incorreta aparece no relatório.
3. Feche e reabra o app. Confirme que coleções, ambientes e configurações reaparecem e que os valores secretos ficam mascarados. Exporte um backup e confira que os valores secretos de ambiente não aparecem no JSON.
4. Instale um pacote mais novo sobre essa instalação com dados de teste. Abra o Fedexe e repita uma rodada com os dados já salvos. Registre as versões anterior e nova, o build do Windows e os resultados.

## Interface

- Coleções e pastas, abas, rascunhos, ordenação e persistência local.
- Editor HTTP com query, autorização, headers, corpo, testes e extrações.
- Respostas formatadas, cópia da prévia e download do corpo completo no desktop.
- Ambientes, variáveis e segredos no Gerenciador de Credenciais do Windows.
- Runner sequencial com diagnóstico por etapa e relatório exportável.
- Histórico, busca global, atalhos, importação/exportação JSON e backup.
- Temas claro/escuro/sistema, modo compacto e controles nativos de janela.

Use `{{variavel}}` nas configurações para reutilizar valores. Salve requisições com `Ctrl+S` e envie com `Ctrl+Enter`. O runner usa a versão salva. `Ctrl+K` abre a busca global.

O desktop grava o workspace em JSON com substituição atômica e guarda os valores secretos de ambiente no Gerenciador de Credenciais do Windows. O navegador usa o armazenamento local e mantém os segredos na sessão. Veja [docs/INTERFACE.md](docs/INTERFACE.md) para o mapa de entregas e os limites conhecidos.

O timeout padrão é de 30 segundos. No desktop, cada endpoint pode seguir redirecionamentos na mesma origem e a validação TLS permanece ativa. A prévia é limitada a 256 KiB e a validação de JSON no runner a 16 MiB. O runner permite continuar ou parar na primeira falha e preserva o resumo parcial ao cancelar.

## Verificar

```powershell
npm run build
npm test
cargo test --locked --features custom-protocol
npm run format:check
```

Em um checkout limpo, rode o build do frontend antes dos testes Rust com `custom-protocol`. O Tauri incorpora os arquivos de `dist` ao compilar esses testes.

O cenário automatizado roda 100 requisições em um servidor local e cobre a extração de token, o uso em requisições subsequentes e a validação de JSON de 10 MiB. Também verifica o truncamento da prévia avulsa.

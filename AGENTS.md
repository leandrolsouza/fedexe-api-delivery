# Fedexe API

O Fedexe API é um cliente HTTP desktop local para Windows. A interface usa React, TypeScript, Vite e Tailwind CSS. O desktop usa Rust e Tauri 2.

## Estrutura do projeto

- `ui/src/App.tsx` integra o editor de requisições, o workspace e o runner. `ui/src/components/` contém as telas e os componentes reutilizáveis da interface.
- `ui/src/lib/` contém os modelos, a importação de cURL e Postman, as validações de resposta, a localização e o transporte HTTP. `transport.ts` seleciona os comandos Tauri no desktop e `fetch` na prévia web.
- `src/main.rs` registra os comandos Tauri. `src/http.rs` implementa o motor HTTP, `src/workspace.rs` cuida da persistência, `src/credentials.rs` integra o Gerenciador de Credenciais do Windows e `src/updates.rs` trata as atualizações.
- `tools/test-server.mjs` serve a coleção de exemplo Acme API. Consulte [docs/INTERFACE.md](docs/INTERFACE.md) para o comportamento da interface e [docs/UPDATER.md](docs/UPDATER.md) para o processo de publicação.

## Desenvolvimento

Use Node.js 22.17 ou superior, Rust com o toolchain MSVC, as ferramentas de build C++ da Microsoft e WebView2 para executar o desktop no Windows.

```powershell
npm ci
npm run tauri dev
```

Use `npm run dev` para abrir a prévia em `http://127.0.0.1:1420`. A prévia usa o armazenamento do navegador e está sujeita a CORS. Valide integrações nativas no desktop. Execute `node tools/test-server.mjs` em outro terminal para exercitar requisições e o runner com dados de exemplo.

## Convenções

- Preserve a compatibilidade com workspaces existentes ao mudar os modelos persistidos. Verifique leitura e gravação no desktop e na prévia web quando a mudança afetar os dois contextos.
- Mantenha os contratos dos comandos Tauri alinhados com as chamadas TypeScript. Ao mudar um comando, confira seus argumentos, retornos e consumidores dos dois lados.
- Preserve a gravação atômica do workspace desktop e mantenha valores secretos de ambiente fora do JSON persistido, dos backups e dos logs. Use o Gerenciador de Credenciais no desktop e o armazenamento de sessão existente na prévia web.
- Para novos textos da interface, use a infraestrutura de localização em `ui/src/lib/i18n.ts` e confira as versões em inglês e português do Brasil. Para mensagens vindas do Rust, confira `ui/src/lib/native-messages.ts`.
- Exiba novos avisos de erro e confirmações de ações concluídas exclusivamente pelo sistema de notificações existente do app (Sonner). Use a própria tela para exibir progresso, resultados detalhados e controles de recuperação.
- Em alterações de versão, mantenha `package.json`, `Cargo.toml` e `tauri.conf.json` alinhados e atualize os lockfiles correspondentes. O workflow `.github/workflows/windows.yml` verifica as versões ao gerar o instalador.

## Verificação

```powershell
npm run build
npm test
cargo test --locked --features custom-protocol
npm run format:check
```

Em um checkout limpo, execute o build do frontend antes dos testes Rust com `custom-protocol`, pois o Tauri incorpora os arquivos de `dist`.

# Assinatura e publicação do atualizador Windows

1. Gere uma chave de produção com `.\node_modules\.bin\tauri.cmd signer generate --write-keys <caminho-fora-do-repositório>`. Guarde a chave privada, a senha e uma cópia de segurança. As próximas versões precisam usar a mesma chave.
2. Nas configurações do GitHub Actions, coloque o conteúdo do arquivo `.pub` na variável `FEDEXE_UPDATER_PUBLIC_KEY`. Configure os secrets `TAURI_SIGNING_PRIVATE_KEY` com o conteúdo da chave privada e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` com sua senha.
3. Execute **Windows installer** no commit da versão com `signed` ativado. Aguarde o smoke test e baixe o artefato `fedexe-windows-nsis`. Confira o SHA-256.
4. Crie um rascunho no GitHub Releases com a tag `v<versão>` no commit testado. Anexe o instalador, seu `.sha256`, seu `.sig` e `latest.json` do mesmo artefato, além dos arquivos de benchmark. Use as [notas da 1.1.0](RELEASE-1.1.0.md) para essa versão.
5. Valide a matriz abaixo antes da publicação. Ao publicar, marque a release estável como **Latest** e confira se `releases/latest/download/latest.json` serve o manifesto esperado. Não marque uma versão preliminar ou sem manifesto como **Latest**.
6. Depois de publicar a 1.1.0, adicione às notas da tag `v1.0.0`: “Para migrar da série 1.0.x, baixe e execute manualmente o [instalador da 1.1.0](https://github.com/leandrolsouza/fedexe-api-delivery/releases/tag/v1.1.0) sobre a instalação existente.”

Para builds locais sem chave, o painel informa que o atualizador não está configurado. O workflow permite esses builds com `signed` desativado.

Valide em uma VM Windows descartável. Use somente dados fictícios. Para não usar a chave ou o canal de produção na VM, gere uma chave de teste e passe um arquivo de configuração ao Tauri CLI via `build --config` com `bundle.createUpdaterArtifacts: true`, a chave pública em `plugins.updater.pubkey` e `plugins.updater.endpoints` apontando para um servidor HTTPS de teste. Gere dois builds com versões estáveis diferentes e a mesma chave de teste. Sirva o manifesto do build mais novo com o endereço HTTPS do instalador de teste.

| Cenário | Resultado esperado |
| --- | --- |
| Instalar a 1.1 sobre a 1.0.x | A coleção, os dois ambientes e os segredos no cofre continuam disponíveis. |
| Abrir o primeiro build assinado | A versão mais nova aparece no aviso de atualização. |
| Selecionar **Adiar** | A sessão continua aberta. É possível voltar ao aviso em **Configurações → Atualizações**. |
| Tentar instalar com rascunhos, execução ou gravação pendente | A interface explica o que precisa ser concluído. |
| Servir o instalador com assinatura inválida | A instalação é recusada e a sessão permanece aberta. |
| Restaurar o manifesto correto e instalar | O NSIS atualiza, o app reabre na versão esperada e os dados e segredos continuam acessíveis. |

Registre os dois builds, a versão do Windows e o resultado de cada cenário. O workflow instala a release 1.0.0, grava dados de teste e verifica se o instalador novo substitui o executável e preserva o workspace. A matriz também cobre o cofre, a decisão de adiar e a atualização pelo app.

# Benchmark da versão 1.0

## Comparação de abertura e repouso no Windows

Cada cliente foi iniciado três vezes. O tempo termina na detecção da janela nativa. A memória privada soma o processo principal e seus descendentes durante quatro segundos, após dois segundos de espera. A tabela apresenta a mediana dos tempos e a faixa das médias de memória das três tentativas.

| Cliente desktop | Mediana até a janela | Média privada em repouso | Processos |
| --- | --- | --- | --- |
| Fedexe 1.0.0-rc.1 | 44 ms | 254,8 a 257,7 MiB | 7 |
| Postman 12.36.4 | 732 ms | 1.123,8 a 1.193,6 MiB | 7 |
| Yaak 2026.9.1 | 42 ms | 348,4 a 352,8 MiB | 9 |

O estado do cache do Windows ficou sem controle, e a detecção da janela não indica que a interface já aceita interação. O Postman estava sem login e sem coleção carregada. Os detalhes de cada tentativa e as medições do runner estão abaixo.

## Cenário reproduzível

O cenário em `tools/benchmark-scenario.mjs` roda em loopback. Cada rodada começa com um login que emite um token novo, seguido de 99 chamadas autenticadas. O servidor rejeita tokens incorretos e requisições fora de ordem. As etapas 25, 50 e 75 retornam exatamente 10 MiB.

```powershell
node tools/benchmark-scenario.mjs export .
node tools/benchmark-scenario.mjs > rodadas.ndjson
```

Importe `benchmark-fedexe.json` no Fedexe e `benchmark-postman.json` no Postman. O Postman recebe testes de status e extração do token em script. Execute um cliente por vez.

Para o Yaak CLI 2026.9.1, importe `benchmark-yaak-2026.9.1.json`, também gerado pelo comando `export`. Ele contém as mesmas requisições do arquivo Postman na ordem de entrada que produziu a sequência correta nessa versão. Gere a variável de ambiente `token` com `node tools/benchmark-scenario.mjs yaak-token rq_ID_DO_LOGIN` e execute o workspace pela CLI em modo sequencial. O **Send All** da interface envia em paralelo. Valide status, ordem e tamanho no log HTTP, pois a CLI informou sucesso mesmo quando o servidor respondeu 409. [Migração do Postman](https://yaak.app/docs/migration/postman) · [Execução de múltiplas requisições](https://yaak.app/docs/advanced/running-multiple-requests)

## Primeira execução do Yaak CLI

No mesmo Windows usado para a medição do Fedexe, a CLI 2026.9.1 completou três rodadas verificadas em **1.122, 1.070 e 1.135 ms**. O cronômetro incluiu a inicialização da CLI, a execução e a escrita da saída em disco, incluindo os corpos. O log confirmou 100 respostas 200 na ordem esperada e três respostas de 10 MiB por rodada. Esses tempos têm limites de medição diferentes dos tempos internos do runner Fedexe. Abertura desktop, memória e cancelamento do Yaak ainda não foram medidos.

Uma segunda série na CLI, com o coletor de memória privada e saída redirecionada para arquivo, registrou máximos de **143,48, 141,71 e 145,54 MiB** em 31, 33 e 32 amostras. As medições incluíram até quatro processos. O servidor confirmou novamente as 300 respostas em ordem. Cada rodada iniciou e encerrou sua própria CLI, portanto esta série cobre memória durante a execução da CLI. As medições de repouso e retenção do Yaak exigem uma sessão desktop.

O servidor escreve uma linha JSON por resposta, com rodada, método, caminho, status, bytes e estado (`finished` ou `aborted`). Uma rodada completa deve ter 100 respostas `finished` com status 200 e três registros de 10.485.760 bytes. O log não inclui o token. Use a confirmação do runner para verificar que o cliente recebeu e processou as respostas.

Rode `node tools/benchmark-scenario.mjs verify rodadas.ndjson` para validar um log de rodadas completas. Use um log novo ao iniciar o servidor para cada cliente. O verificador exige o login e as 99 consultas em ordem, status HTTP 200 e o tamanho previsto em cada etapa. Para as rodadas de cancelamento, confira separadamente os eventos `waiting` e `aborted`.

O Fedexe desktop também executou o arquivo `benchmark-postman.json` importado diretamente. O importador converteu os testes de status e a extração do token para regras declarativas. O runner aprovou as 100 etapas em um build de desenvolvimento, e o servidor confirmou a ordem e as três respostas grandes. Essa rodada valida a migração do cenário.

Para medir cancelamento, reinicie o servidor com `node tools/benchmark-scenario.mjs --cancel-scenario`. O servidor sinaliza a chegada da segunda etapa com `waiting` e atrasa a resposta em cinco segundos. Meça desde o clique em cancelar até o estado final da rodada na interface. O registro `aborted` confirma o fechamento da conexão pelo cliente.

Ao encerrar externamente o Yaak CLI com `Stop-Process` durante essa espera, os processos saíram em **9, 6 e 7 ms**. O servidor registrou o fechamento da conexão em **5, 2 e 1 ms** e nenhuma etapa posterior em cada rodada. Esses valores medem a interrupção do processo CLI pelo Windows. Cancelamento pela interface desktop segue pendente.

## Comparabilidade com a interface do Yaak

O Yaak desktop 2026.9.1 não oferece um runner sequencial integrado. A opção **Send All** dispara as requisições da pasta em paralelo, enquanto o cenário exige que cada requisição espere a anterior e que as consultas usem o token emitido no início daquela rodada. Tempo total do runner, cancelamento da rodada e memória durante ou entre rodadas sequenciais ficam sem medição desktop diretamente comparável. A série da CLI acima é a referência disponível para a execução sequencial. [Documentação do Yaak](https://yaak.app/docs/advanced/running-multiple-requests)

## Abertura e repouso do Yaak desktop

Foi usado o executável x64 extraído do instalador oficial 2026.9.1, com SHA-256 conferido. No mesmo Windows, a abertura foi medida até a detecção da janela nativa. A coleta de quatro segundos começou dois segundos depois e somou a memória privada dos nove processos da árvore. Nenhuma requisição estava em execução. [Release oficial do Yaak](https://github.com/mountain-loop/yaak/releases/tag/v2026.9.1)

| Tentativa | Janela detectada | Amostras | Média privada em repouso | Máxima amostra |
| --- | --- | --- | --- | --- |
| 1 | 442 ms | 43 | 352,8 MiB | 354,3 MiB |
| 2 | 39 ms | 44 | 352,6 MiB | 363,4 MiB |
| 3 | 42 ms | 44 | 348,4 MiB | 358,3 MiB |

## Execução pelo Newman

O Newman 6.2.3 executou a coleção Postman no mesmo Windows e contra o mesmo servidor local. As três rodadas levaram **11.168, 11.060 e 11.145 ms**, medidos desde a invocação do comando até a saída com código zero. Esses tempos incluem a inicialização e o encerramento do processo. O servidor confirmou, em cada rodada, as 100 respostas HTTP 200 na ordem esperada, a autenticação com o token emitido no login e as três respostas de 10 MiB.

```powershell
newman run benchmark-postman.json --reporters cli --reporter-cli-silent
node tools/benchmark-scenario.mjs verify rodadas.ndjson
```

Esta série cobre a execução pela CLI.

## Abertura e repouso do Postman desktop

No mesmo Windows, o Postman 12.36.4 foi iniciado três vezes, fechando todos os processos entre as tentativas. O tempo de abertura vai da solicitação de inicialização até a primeira detecção da janela principal com título Postman. Após dois segundos de espera, o coletor amostrou quatro segundos de memória privada dos sete processos da árvore.

| Tentativa | Janela detectada | Amostras | Média privada em repouso | Máxima amostra |
| --- | --- | --- | --- | --- |
| 1 | 1.241 ms | 35 | 1.193,6 MiB | 1.202,0 MiB |
| 2 | 723 ms | 37 | 1.123,8 MiB | 1.130,4 MiB |
| 3 | 732 ms | 37 | 1.159,5 MiB | 1.161,8 MiB |

As amostras correspondem à sessão desktop sem login e sem coleção carregada. A detecção da janela tem um ponto de término diferente da observação de abertura do Fedexe com Playwright.

No Postman desktop autenticado, o runner funcional local concluiu a coleção em **10.550 ms**, com 100 testes aprovados e zero erros. O log independente confirmou 100 respostas HTTP 200 em ordem, incluindo as três respostas de 10 MiB. A janela HTTP no servidor foi de **10.232 ms**.

O coletor amostrou somente o processo proprietário da janela nesta rodada. Nesse processo, a média no segundo anterior à primeira requisição foi de **640,8 MiB**, o pico durante a janela HTTP foi de **769,4 MiB** e a média entre dois e três segundos após a última resposta foi de **742,5 MiB**.

Na rodada seguinte, o coletor somou os oito processos da árvore em 599 amostras. O Postman concluiu os 100 testes em **10.513 ms**, com zero erros. O servidor verificou novamente as 100 respostas, com uma janela HTTP de **10.120 ms**. A memória privada média no segundo anterior foi de **1.169,0 MiB** (11 amostras). O pico durante a janela HTTP foi de **1.498,2 MiB** (112 amostras), e a média entre dois e três segundos após a última resposta foi de **1.436,9 MiB** (14 amostras). Em duas rodadas de cancelamento, a segunda resposta foi atrasada em 25 segundos. O servidor registrou o fechamento da conexão 126 ms e 86 ms após o início da ação automatizada de clicar em **Stop Run**. Nenhuma etapa posterior chegou ao servidor. Na segunda rodada, a automação observou **Stopped at 2%** em 737 ms, incluindo o tempo de consulta à interface.

## Abertura e repouso do Fedexe

O executável de produção 1.0.0-rc.1 foi iniciado três vezes no mesmo Windows, usando a detecção de janela principal e a janela de amostragem de quatro segundos da série do Postman. As amostras somam o executável e seis processos WebView2. Nenhuma rodada do runner estava em andamento.

| Tentativa | Janela detectada | Amostras | Média privada em repouso | Máxima amostra |
| --- | --- | --- | --- | --- |
| 1 | 535 ms | 36 | 257,7 MiB | 258,7 MiB |
| 2 | 44 ms | 37 | 254,8 MiB | 256,5 MiB |
| 3 | 43 ms | 38 | 256,6 MiB | 258,6 MiB |

O primeiro processo foi iniciado sem reiniciar o Windows. O estado de cache do sistema não foi controlado. O tempo de detecção indica que a janela nativa apareceu, antes de confirmar que o conteúdo do WebView está pronto para interação.

## Primeira execução do Fedexe

Em 14 de novembro de 2026, no Windows build 26300, o build de produção do Fedexe completou três rodadas com 100 etapas aprovadas por rodada.

| Métrica | Resultado inicial |
| --- | --- |
| Tempo do runner | 54, 52 e 50 ms |
| Abertura observada | 1.872 ms, incluindo conexão e espera do Playwright |
| Cancelamento observado | 50, 46 e 47 ms, incluindo o clique do Playwright |
| Memória privada antes da primeira rodada | 394,5 MiB |
| Maior amostra de memória privada | 419,0 MiB |
| Última amostra após a terceira rodada | 314,5 MiB |

A memória soma o executável e seis processos WebView2 descendentes. Foram coletadas 75 amostras com pausa de 150 ms mais o tempo de consulta ao sistema. Como cada rodada durou cerca de 50 ms, a maior amostra pode subestimar o pico. Ainda é preciso sincronizar as amostras de memória com as rodadas, repetir a abertura e medir Postman e Yaak na mesma máquina antes de publicar a comparação.

## Coleta de memória

Com o cliente aberto, use o PID do processo principal no Gerenciador de Tarefas e inicie a coleta antes da rodada:

```powershell
./tools/benchmark-memory.ps1 -RootProcessId 12345 -Seconds 30 -IntervalMs 10 -OutputPath ./memoria.csv
```

O CSV traz horário UTC em milissegundos Unix, total de bytes privados e quantidade de processos amostrados. O script atualiza a árvore de processos a cada segundo e mede a memória com a lista de PIDs entre as atualizações. Use os horários reais do CSV ao comparar com as janelas de cada rodada. O intervalo solicitado é uma pausa entre amostras e o Windows pode entregá-las com intervalos maiores.

Com o coletor, uma segunda execução do Fedexe registrou 374 amostras em 20 segundos. Cada amostra incluiu o executável e seis processos WebView2. A janela de cada rodada começou antes do clique automatizado e terminou quando o resumo apareceu. As médias de repouso usam 500 ms antes da janela e de 2 a 2,5 s depois dela.

| Rodada | Tempo do runner | Antes | Máxima amostra na janela | Amostras na janela | Depois |
| --- | --- | --- | --- | --- | --- |
| 1 | 53 ms | 351,0 MiB | 372,2 MiB | 4 | 371,6 MiB |
| 2 | 48 ms | 350,0 MiB | 345,6 MiB | 3 | 343,8 MiB |
| 3 | 49 ms | 341,1 MiB | 314,6 MiB | 2 | 315,5 MiB |

As três rodadas aprovaram as 100 etapas. As janelas incluem o custo da automação, e duas a quatro amostras por execução ainda podem deixar picos curtos entre as amostras.

import { t, type Message } from './i18n';

// Tauri returns application errors as strings. Keep the accepted templates explicit so
// system diagnostics and text supplied by the user pass through untouched.
const templates = [
  'Não foi possível concluir a operação no Google Drive.',
  'O backup excede o limite de 5 MB.',
  'Reconecte a conta Google para acessar os backups.',
  'Conecte uma conta Google para acessar os backups.',
  'Informe as credenciais OAuth de um cliente desktop do Google.',
  'O provedor OAuth 2.0 recusou a autenticação ou retornou uma resposta inválida.',
  'Confira a configuração OAuth 2.0. Use HTTPS ou HTTP em um endereço de loopback.',
  'Conecte a sessão OAuth 2.0 pelo editor de autorização.',
  'Authorization Code com PKCE está disponível no app desktop.',
  'Já existe uma operação OAuth 2.0 em andamento.',
  'O tempo para concluir a autorização OAuth 2.0 expirou.',
  'OAuth 2.0 exige que o header Authorization seja gerado pelo app.',
  'OAuth 2.0 exige HTTPS para enviar o token fora do loopback.',
  'Não foi possível abrir o navegador para a autorização OAuth 2.0.',
  'Limite de 10 redirecionamentos excedido.',
  'Arquivo do corpo indisponível. Selecione o arquivo novamente.',
  'Não foi possível abrir o arquivo do corpo.',
  'Não foi possível ler os dados do arquivo.',
  'Selecione um arquivo regular para o corpo.',
  'Variável sem fechamento.',
  'Variável ausente: {0}',
  'Use uma URL HTTP(S) e informe credenciais nos headers.',
  'Nome de header inválido.',
  'Valor inválido para o header {0}.',
  'Arquivo multipart sem nome.',
  'JSON inválido: {0}',
  'Requisição ausente.',
  'Corpo acima do limite de validação de 16 MiB.',
  'Adicione pelo menos uma requisição.',
  'Identificador de segredo inválido.',
  'O cofre contém um segredo que não pôde ser lido.',
  'O segredo excede o limite do cofre do Windows.',
  'Já existe uma execução ativa.',
  'O corpo desta resposta não está mais disponível.',
  'O atualizador está ocupado.',
  'Não foi possível iniciar o atualizador.',
  'Não foi possível consultar as atualizações. Tente novamente em Configurações.',
  'Verifique novamente se há atualizações.',
  'Verificando assinatura e preparando a instalação…',
  'A assinatura do pacote não pôde ser validada. Baixe a versão oficial no GitHub Releases.',
  'Não foi possível baixar a atualização. Verifique a conexão e tente novamente.',
  'Não foi possível iniciar o instalador. Tente novamente ou baixe a versão no GitHub Releases.',
  'A requisição excedeu o timeout configurado.',
  'O timeout deve ficar entre 1 e 600.000 ms.',
  'Execução cancelada.',
  'Remova Content-Length e Transfer-Encoding manuais deste corpo.',
  'Remova o Content-Type manual para gerar o boundary multipart.',
  'Informe o nome de cada parte multipart ativa.',
  'Parâmetro de caminho ausente: {0}.',
  'Valor inválido para o parâmetro de caminho: {0}.',
  'Status esperado {0}, recebido {1}.',
  'Header ausente: {0}',
  'Valor inesperado no header {0}.',
  'JSON Pointer inválido: {0}.',
  'Valor inesperado em {0}.',
  'Extração exige um valor escalar em {0}.',
] satisfies Message[];

const patterns = templates
  .filter((template) => template.includes('{0}'))
  .map((template) => {
    const pattern = template
      .split(/\{\d+\}/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('([\\s\\S]*?)');
    return { template, pattern: new RegExp(`^${pattern}$`) };
  });

export function localizeNativeMessage(message: string): string {
  const literal = templates.find((template) => template === message && !template.includes('{0}'));
  if (literal) return t(literal);

  for (const { template, pattern } of patterns) {
    const match = pattern.exec(message);
    if (match) return t(template, ...match.slice(1));
  }
  return message;
}

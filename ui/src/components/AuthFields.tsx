import { useState } from 'react';
import { toast } from 'sonner';
import { native, updateOAuthSession } from '../lib/transport';
import { t } from '../lib/i18n';
import type { Auth, OAuthConfig } from '../lib/models';

const authLabels = {
  inherit: 'Herdar da coleção',
  none: 'Sem autorização',
  bearer: 'Bearer token',
  basic: 'Basic',
  'api-key': 'API key',
  oauth2: 'OAuth 2.0',
} as const;

const fieldLabels = {
  token: 'Token',
  username: 'Usuário',
  password: 'Senha',
  key: 'Nome da chave',
  value: 'Valor da chave',
} as const;

export function authLabel(type: Auth['type']) {
  return t(authLabels[type]);
}

const fieldsByType: Record<Auth['type'], (keyof typeof fieldLabels)[]> = {
  inherit: [],
  none: [],
  bearer: ['token'],
  basic: ['username', 'password'],
  'api-key': ['key', 'value'],
  oauth2: [],
} as const;

export function AuthType({
  auth,
  onChange,
  inheritance = false,
}: {
  auth: Auth;
  onChange: (auth: Auth) => void;
  inheritance?: boolean;
}) {
  return (
    <label className="field-label">
      {t('Tipo de autorização')}
      <select
        className="input"
        value={!inheritance && auth.type === 'inherit' ? 'none' : auth.type}
        onChange={(event) => {
          const type = event.target.value as Auth['type'];
          onChange({
            ...auth,
            type,
            ...(type === 'oauth2' && { oauth: auth.oauth ?? defaultOAuth }),
          });
        }}
      >
        {(Object.keys(authLabels) as Auth['type'][])
          .filter((type) => inheritance || type !== 'inherit')
          .map((type) => (
            <option key={type} value={type}>
              {authLabel(type)}
            </option>
          ))}
      </select>
    </label>
  );
}

export function AuthFields({ auth, onChange }: { auth: Auth; onChange: (auth: Auth) => void }) {
  return (
    <>
      {fieldsByType[auth.type].map((key) => (
        <label className="field-label" key={key}>
          {t(fieldLabels[key])}
          <input
            className="input mono"
            autoComplete="off"
            type={key === 'username' || key === 'key' ? 'text' : 'password'}
            value={auth[key]}
            onChange={(event) => onChange({ ...auth, [key]: event.target.value })}
            placeholder={key === 'token' ? '{{token}}' : undefined}
          />
        </label>
      ))}
      {auth.type === 'oauth2' && auth.oauth && (
        <OAuthFields config={auth.oauth} onChange={(oauth) => onChange({ ...auth, oauth })} />
      )}
      {auth.type === 'api-key' && (
        <label className="field-label">
          {t('Adicionar em')}
          <select
            className="input"
            value={auth.placement}
            onChange={(event) =>
              onChange({ ...auth, placement: event.target.value as Auth['placement'] })
            }
          >
            <option value="header">Header</option>
            <option value="query">Query</option>
          </select>
        </label>
      )}
    </>
  );
}

const defaultOAuth: OAuthConfig = {
  grant: 'pkce',
  authorization_url: '',
  token_url: '',
  client_id: '',
  client_secret: '',
  scope: '',
};

const oauthLabels = {
  authorization_url: 'URL de autorização',
  token_url: 'URL de token',
  client_id: 'Client ID',
  client_secret: 'Client secret',
  scope: 'Escopo OAuth 2.0',
} as const;

function OAuthFields({
  config,
  onChange,
}: {
  config: OAuthConfig;
  onChange: (value: OAuthConfig) => void;
}) {
  const [pending, setPending] = useState(false);
  const pkce = config.grant === 'pkce';
  const fields = Object.keys(oauthLabels) as (keyof typeof oauthLabels)[];
  async function updateSession(action: 'connect' | 'disconnect') {
    setPending(true);
    try {
      const { authorization_url, token_url, client_id, scope } = config;
      await updateOAuthSession(action, { authorization_url, token_url, client_id, scope });
      toast.success(
        t(action === 'connect' ? 'Sessão OAuth 2.0 conectada.' : 'Sessão OAuth 2.0 desconectada.'),
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <fieldset className="grid gap-3" disabled={pending}>
      <label className="field-label">
        {t('Fluxo OAuth 2.0')}
        <select
          className="input"
          value={config.grant}
          onChange={(event) =>
            onChange({ ...config, grant: event.target.value as OAuthConfig['grant'] })
          }
        >
          <option value="pkce">{t('Authorization Code com PKCE')}</option>
          <option value="client_credentials">Client Credentials</option>
        </select>
      </label>
      {fields
        .filter((key) => key !== (pkce ? 'client_secret' : 'authorization_url'))
        .map((key) => (
          <label className="field-label" key={key}>
            {t(oauthLabels[key])}
            <input
              className="input mono"
              autoComplete="off"
              value={config[key]}
              type={key === 'client_secret' ? 'password' : 'text'}
              onChange={(event) => onChange({ ...config, [key]: event.target.value })}
            />
          </label>
        ))}
      {pkce && native && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="button"
            disabled={!config.authorization_url || !config.token_url || !config.client_id}
            onClick={() => void updateSession('connect')}
          >
            {t('Conectar no navegador')}
          </button>
          <button
            type="button"
            className="button"
            disabled={!config.authorization_url || !config.token_url || !config.client_id}
            onClick={() => void updateSession('disconnect')}
          >
            {t('Desconectar sessão')}
          </button>
        </div>
      )}
      {pending && <p role="status">{t('Operação OAuth 2.0 em andamento…')}</p>}
      {!native && <p>{t('OAuth 2.0 está disponível no app desktop e na CLI.')}</p>}
    </fieldset>
  );
}

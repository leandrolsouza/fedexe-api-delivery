import type { Auth } from '../lib/models';

export const authLabels: Record<Auth['type'], string> = {
  inherit: 'Herdar da coleção',
  none: 'Sem autorização',
  bearer: 'Bearer token',
  basic: 'Basic',
  'api-key': 'API key',
};

const fieldLabels = {
  token: 'Token',
  username: 'Usuário',
  password: 'Senha',
  key: 'Nome da chave',
  value: 'Valor da chave',
};

const fieldsByType: Record<Auth['type'], (keyof typeof fieldLabels)[]> = {
  inherit: [],
  none: [],
  bearer: ['token'],
  basic: ['username', 'password'],
  'api-key': ['key', 'value'],
};

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
      Tipo de autorização
      <select
        className="input"
        value={!inheritance && auth.type === 'inherit' ? 'none' : auth.type}
        onChange={(event) => onChange({ ...auth, type: event.target.value as Auth['type'] })}
      >
        {(Object.keys(authLabels) as Auth['type'][])
          .filter((type) => inheritance || type !== 'inherit')
          .map((type) => (
            <option key={type} value={type}>
              {authLabels[type]}
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
          {fieldLabels[key]}
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
      {auth.type === 'api-key' && (
        <label className="field-label">
          Adicionar em
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

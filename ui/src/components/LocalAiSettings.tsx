import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import { formatNumber, t, type Message } from '../lib/i18n';
import { native } from '../lib/transport';
import { Button } from './ui/button';

type Preferences = {
  provider: 'off' | 'local';
  endpoint: string;
  model: string;
};

const storageKey = 'fedexe.ai';
const defaults: Preferences = { provider: 'off', endpoint: 'http://127.0.0.1:1234/v1', model: '' };

function readPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return {
      provider: saved?.provider === 'local' ? 'local' : 'off',
      endpoint: typeof saved?.endpoint === 'string' ? saved.endpoint : defaults.endpoint,
      model: typeof saved?.model === 'string' ? saved.model : defaults.model,
    };
  } catch {
    return defaults;
  }
}

function isLocalEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.href.includes('?') &&
      !url.href.includes('#')
    );
  } catch {
    return false;
  }
}

const errorMessages: Record<string, Message> = {
  invalidEndpoint: 'Informe um endpoint local válido, sem credenciais, parâmetros ou fragmento.',
  modelRequired: 'Informe o identificador do modelo.',
  unavailable: 'Servidor de IA indisponível. Verifique se ele está em execução.',
  timeout: 'O servidor de IA excedeu o tempo limite.',
  invalidResponse: 'O servidor de IA devolveu uma resposta incompatível.',
};

function aiError(error: unknown) {
  if (typeof error === 'string' && Object.hasOwn(errorMessages, error)) {
    return t(errorMessages[error]);
  }
  if (error && typeof error === 'object' && 'serverStatus' in error) {
    return t('O servidor de IA retornou HTTP {0}.', String(error.serverStatus));
  }
  return t('Não foi possível concluir a operação de IA.');
}

export function LocalAiSettings() {
  const [saved, setSaved] = useState(readPreferences);
  const [draft, setDraft] = useState(saved);
  const [models, setModels] = useState<string[]>([]);
  const [pending, setPending] = useState<'list' | 'test' | null>(null);
  const { provider, endpoint, model } = draft;
  const hasChanges =
    provider !== saved.provider || endpoint !== saved.endpoint || model !== saved.model;

  function update(patch: Partial<Preferences>) {
    setDraft({ ...draft, ...patch });
    if (patch.endpoint !== undefined) setModels([]);
  }

  function save() {
    const preferences =
      provider === 'off'
        ? { ...saved, provider }
        : { provider, endpoint: endpoint.trim(), model: model.trim() };
    if (provider === 'local' && !isLocalEndpoint(preferences.endpoint)) {
      toast.error(t(errorMessages.invalidEndpoint));
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
      setSaved(preferences);
      setDraft(preferences);
      toast.success(t('Preferências de IA salvas.'));
    } catch {
      toast.error(t('Não foi possível salvar as preferências de IA.'));
    }
  }

  async function connect(operation: 'list' | 'test') {
    if (!isLocalEndpoint(endpoint.trim())) {
      toast.error(t(errorMessages.invalidEndpoint));
      return;
    }
    setPending(operation);
    try {
      if (operation === 'list') {
        const available = await invoke<string[]>('ai_list_models', { endpoint });
        setModels(available);
        if (available.length) toast.success(t('Modelos carregados.'));
        else toast.info(t('O servidor não listou modelos. Você pode digitar o identificador.'));
      } else {
        const elapsed = await invoke<number>('ai_test_model', { endpoint, model });
        toast.success(t('Modelo respondeu em {0} ms.', formatNumber(elapsed)));
      }
    } catch (error) {
      toast.error(aiError(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="surface settings-surface">
      <div className="settings-section-heading">
        <h2>{t('IA')}</h2>
      </div>
      <label className="field-label workspace-name-field">
        {t('Provedor de IA')}
        <select
          className="input"
          value={provider}
          disabled={pending !== null}
          onChange={(event) =>
            update({ provider: event.target.value === 'local' ? 'local' : 'off' })
          }
        >
          <option value="off">{t('IA desativada')}</option>
          <option value="local">{t('Compatível com OpenAI (local)')}</option>
        </select>
      </label>
      {provider === 'local' && (
        <>
          <div className="settings-default-field">
            <label className="field-label">
              {t('Endpoint da API')}
              <input
                className="input"
                value={endpoint}
                spellCheck={false}
                autoComplete="off"
                disabled={pending !== null}
                onChange={(event) => update({ endpoint: event.target.value })}
              />
            </label>
            <p className="field-hint">
              LM Studio: <code>http://127.0.0.1:1234/v1</code> · Ollama:{' '}
              <code>http://127.0.0.1:11434/v1</code>
            </p>
          </div>
          <div className="settings-default-field">
            <label className="field-label">
              {t('Modelo de IA')}
              <input
                className="input"
                value={model}
                list="fedexe-ai-models"
                placeholder={t('Digite ou selecione um modelo')}
                spellCheck={false}
                autoComplete="off"
                disabled={pending !== null}
                onChange={(event) => update({ model: event.target.value })}
              />
            </label>
            <datalist id="fedexe-ai-models">
              {models.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <Button
              variant="outline"
              disabled={!native || pending !== null || !endpoint.trim()}
              onClick={() => void connect('list')}
            >
              {t(pending === 'list' ? 'Carregando modelos…' : 'Carregar modelos')}
            </Button>
          </div>
          {!native && (
            <p className="field-hint">
              {t('A conexão com o servidor de IA está disponível no aplicativo desktop.')}
            </p>
          )}
          <Button
            disabled={!native || pending !== null || !endpoint.trim() || !model.trim()}
            onClick={() => void connect('test')}
          >
            {t(pending === 'test' ? 'Testando modelo…' : 'Testar conexão')}
          </Button>
          <p className="field-hint">{t('O teste envia somente uma mensagem de exemplo.')}</p>
        </>
      )}
      <Button variant="outline" disabled={!hasChanges || pending !== null} onClick={save}>
        {t('Salvar preferências de IA')}
      </Button>
    </section>
  );
}

import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import {
  importPostmanItems,
  itemKey,
  listPostmanWorkspaces,
  loadPostmanSpecs,
  postmanError,
  readPostmanWorkspace,
  unsupportedPostmanIssues,
  type PostmanGet,
  type PostmanImport,
} from '../lib/postman-workspace';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

const get: PostmanGet = (resource) => invoke('postman_get', { resource });

export function PostmanWorkspaceDialog({
  onClose,
  onImport,
  onFailure,
}: {
  onClose: () => void;
  onFailure: () => void;
  onImport: (name: string, result: PostmanImport) => void;
}) {
  const [hasKey, setHasKey] = useState(false);
  const [checkingKey, setCheckingKey] = useState(true);
  const [key, setKey] = useState('');
  const [workspaces, setWorkspaces] = useState<ReturnType<typeof listPostmanWorkspaces>>();
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspace, setWorkspace] = useState<ReturnType<typeof readPostmanWorkspace>>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const issues = workspace ? unsupportedPostmanIssues(workspace) : [];

  useEffect(() => {
    let active = true;
    invoke<boolean>('postman_has_key')
      .then((stored) => {
        if (active) setHasKey(stored);
      })
      .catch((failure: unknown) => {
        if (active) toast.error(postmanError(failure));
      })
      .finally(() => {
        if (active) setCheckingKey(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      toast.error(postmanError(failure));
      onFailure();
    } finally {
      setBusy(false);
    }
  }

  function clearWorkspace() {
    setWorkspaceId('');
    setWorkspace(undefined);
    setSelected(new Set());
  }

  function listWorkspaces() {
    return perform(async () => {
      const entered = key.trim();
      setKey('');
      const response = entered
        ? await invoke('postman_connect', { key: entered })
        : await get({ kind: 'workspaces' });
      if (entered) setHasKey(true);
      setWorkspaces(listPostmanWorkspaces(response));
      clearWorkspace();
    });
  }

  function loadMore(cursor: string) {
    return perform(async () => {
      const page = listPostmanWorkspaces(await get({ kind: 'workspaces', cursor }));
      setWorkspaces((previous) => {
        const refs = new Map(previous?.items.map((item) => [item.id, item]));
        for (const item of page.items) refs.set(item.id, item);
        return { items: [...refs.values()], cursor: page.cursor === cursor ? '' : page.cursor };
      });
    });
  }

  function openWorkspace(id: string) {
    clearWorkspace();
    setWorkspaceId(id);
    if (!id) return;
    return perform(async () => {
      const legacy = readPostmanWorkspace(await get({ kind: 'workspace', id }));
      let data = legacy;
      try {
        data = await loadPostmanSpecs(legacy, id, get);
      } catch (failure) {
        toast.error(t('OpenAPI: {0}', postmanError(failure)));
      }
      setWorkspace(data);
      setSelected(new Set(data.items.map(itemKey)));
    });
  }

  function removeKey() {
    return perform(async () => {
      await invoke('postman_remove_key');
      setHasKey(false);
      setKey('');
      setWorkspaces(undefined);
      clearWorkspace();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      dismissible={!busy}
      title={t('Importar workspace do Postman')}
      description={t('A chave de API é armazenada no Gerenciador de Credenciais do Windows.')}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void listWorkspaces();
        }}
      >
        <label>
          {hasKey ? t('Nova chave de API do Postman') : t('Chave de API do Postman')}
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={busy || checkingKey}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <div className="dialog-footer">
          {hasKey && (
            <Button type="button" variant="outline" onClick={removeKey} disabled={busy}>
              {t('Remover chave salva')}
            </Button>
          )}
          <Button type="submit" disabled={busy || checkingKey || (!key.trim() && !hasKey)}>
            {t('Listar workspaces')}
          </Button>
        </div>
      </form>
      {workspaces?.items.length ? (
        <div className="dialog-footer">
          <label>
            {t('Workspace do Postman')}
            <select
              className="input"
              value={workspaceId}
              onChange={(event) => void openWorkspace(event.target.value)}
              disabled={busy}
            >
              <option value="">{t('Selecione um workspace')}</option>
              {workspaces.items.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {workspaceId && !workspace && !busy && (
            <Button variant="outline" onClick={() => void openWorkspace(workspaceId)}>
              {t('Tentar novamente')}
            </Button>
          )}
        </div>
      ) : (
        workspaces && <p>{t('Nenhum workspace encontrado.')}</p>
      )}
      {workspaces?.cursor && (
        <Button variant="outline" onClick={() => loadMore(workspaces.cursor)} disabled={busy}>
          {t('Carregar mais workspaces')}
        </Button>
      )}
      {workspace && (
        <>
          {workspace.items.length > 0 ? (
            <fieldset disabled={busy}>
              <legend>{t('Itens para importar')}</legend>
              <div className="dialog-footer">
                <Button
                  variant="outline"
                  onClick={() => setSelected(new Set(workspace.items.map(itemKey)))}
                >
                  {t('Selecionar todos')}
                </Button>
                <Button variant="outline" onClick={() => setSelected(new Set())}>
                  {t('Desmarcar todos')}
                </Button>
              </div>
              <ul className="import-report">
                {workspace.items.map((item) => {
                  const id = itemKey(item);
                  return (
                    <li key={id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.add(id);
                              else next.delete(id);
                              return next;
                            });
                          }}
                        />{' '}
                        {item.kind === 'collection'
                          ? t('Coleção')
                          : item.kind === 'spec'
                            ? 'OpenAPI'
                            : t('Ambiente')}{' '}
                        · {item.name}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ) : (
            <p>{t('O workspace não contém coleções nem ambientes disponíveis.')}</p>
          )}
          {issues.length > 0 && (
            <ul className="import-report">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {busy && <p role="status">{t('Consultando o Postman…')}</p>}
      <div className="dialog-footer">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          {t('Cancelar')}
        </Button>
        <Button
          disabled={busy || !workspace || !selected.size}
          onClick={() => {
            if (!workspace) return;
            void perform(async () => {
              const items = workspace.items.filter((item) => selected.has(itemKey(item)));
              onImport(workspace.name, await importPostmanItems(items, get, issues));
            });
          }}
        >
          {t('Importar {0} item(ns)', selected.size)}
        </Button>
      </div>
    </Dialog>
  );
}

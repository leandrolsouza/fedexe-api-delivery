import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { formatNumber, t, useLocale } from '../lib/i18n';
import { driveBackupSnapshot, loadWorkspace, type Workspace } from '../lib/models';
import { normalizeError } from '../lib/transport';
import { PageHeading } from './WorkspaceViews';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

type Backup = { id: string; createdTime: string };
type BackupPage = { files: Backup[]; nextPageToken: string | null };

export function DriveBackups({
  active,
  workspace,
  blocked,
  backupUnavailable,
  onRestore,
  onBackup,
  onFailure,
}: {
  active: boolean;
  workspace: Workspace;
  blocked: boolean;
  backupUnavailable: boolean;
  onRestore: (workspace: Workspace) => void;
  onBackup: () => void;
  onFailure: (operation: 'backup' | 'restore') => void;
}) {
  const locale = useLocale();
  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [files, setFiles] = useState<Backup[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);
  const [preview, setPreview] = useState<Workspace>();
  const operation = useRef(true);
  const started = useRef(false);

  async function list(page?: string) {
    const result = await invoke<BackupPage>('drive_list', { page });
    setFiles((current) => (page ? [...current, ...result.files] : result.files));
    setNextPage(result.nextPageToken);
  }

  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void invoke<boolean>('drive_status')
      .then(async (configured) => {
        setConnected(configured);
        if (configured) await list();
      })
      .catch((failure) => setError(normalizeError(failure).message))
      .finally(() => {
        operation.current = false;
        setPending(false);
      });
  }, [active]);

  async function run(work: () => Promise<void>, outcome?: 'backup' | 'restore') {
    if (operation.current) return;
    operation.current = true;
    setPending(true);
    setError('');
    try {
      await work();
    } catch (failure) {
      setError(normalizeError(failure).message);
      if (outcome) onFailure(outcome);
    } finally {
      operation.current = false;
      setPending(false);
    }
  }

  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="workspace-page">
      <PageHeading
        title={t('Backups no Google Drive')}
        description={t(
          'Transfira um workspace entre instalações usando a mesma conta e o mesmo projeto Google Cloud.',
        )}
      />
      <section className="surface settings-surface" aria-busy={pending}>
        {!connected ? (
          <form
            className="drive-controls"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await invoke('drive_connect', {
                  client: { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
                });
                setClientSecret('');
                setClientId('');
                setConnected(true);
                await list();
              });
            }}
          >
            <p className="field-hint">
              {t(
                'Ative a API Google Drive em um projeto Google Cloud e crie um cliente OAuth do tipo App para computador.',
              )}
            </p>
            <label className="field">
              <span>{t('Client ID')}</span>
              <input
                className="input"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <label className="field">
              <span>{t('Client secret')}</span>
              <input
                className="input"
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <Button disabled={pending || !clientId.trim() || !clientSecret.trim()} type="submit">
              {t('Conectar no navegador')}
            </Button>
          </form>
        ) : (
          <div className="drive-controls">
            <div className="settings-backup-actions">
              <Button
                disabled={pending || blocked || backupUnavailable}
                onClick={() => setPreview(driveBackupSnapshot(workspace))}
              >
                {t('Criar backup no Drive')}
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => void run(() => list())}>
                {t('Recarregar backups')}
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    await invoke('drive_disconnect');
                    setConnected(false);
                    setFiles([]);
                    setNextPage(null);
                  })
                }
              >
                {t('Desconectar sessão')}
              </Button>
            </div>
            {blocked && (
              <p className="field-hint">
                {t('Conclua a execução e salve ou descarte os rascunhos antes de usar o backup.')}
              </p>
            )}
            {files.length ? (
              <ul className="drive-list">
                {files.map((file) => (
                  <li key={file.id}>
                    <time dateTime={file.createdTime}>
                      {Number.isFinite(Date.parse(file.createdTime))
                        ? date.format(new Date(file.createdTime))
                        : file.createdTime}
                    </time>
                    <Button
                      variant="outline"
                      disabled={pending || blocked}
                      onClick={() =>
                        void run(async () => {
                          const data = await invoke<string>('drive_download', { id: file.id });
                          onRestore(driveBackupSnapshot(loadWorkspace(data)));
                        }, 'restore')
                      }
                    >
                      {t('Restaurar backup')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              !pending && !error && <p>{t('Nenhum backup encontrado.')}</p>
            )}
            {nextPage && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void run(() => list(nextPage))}
              >
                {t('Carregar mais backups')}
              </Button>
            )}
          </div>
        )}
        {pending && <p role="status">{t('Operação do Google Drive em andamento…')}</p>}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </section>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(undefined)}
        title={t('Criar backup no Drive')}
        description={t(
          'O arquivo inclui as configurações do workspace e omite credenciais e valores secretos.',
        )}
      >
        {preview && (
          <>
            <ul className="import-report">
              <li>
                <details>
                  <summary>
                    {t('{0} coleção(ões)', formatNumber(preview.collections.length))}
                  </summary>
                  <ul>
                    {preview.collections.map((collection) => (
                      <li key={collection.id}>{collection.name}</li>
                    ))}
                  </ul>
                </details>
              </li>
              <li>
                {t(
                  '{0} pasta(s)',
                  formatNumber(
                    preview.collections.reduce(
                      (sum, collection) => sum + collection.folders.length,
                      0,
                    ),
                  ),
                )}
              </li>
              <li>
                {t(
                  '{0} requisição(ões)',
                  formatNumber(
                    preview.collections.reduce(
                      (sum, collection) => sum + collection.requests.length,
                      0,
                    ),
                  ),
                )}
              </li>
              <li>
                <details>
                  <summary>
                    {t('{0} ambiente(s)', formatNumber(preview.environments.length))}
                  </summary>
                  <ul>
                    {preview.environments.map((environment) => (
                      <li key={environment.id}>{environment.name}</li>
                    ))}
                  </ul>
                </details>
              </li>
            </ul>
            <div className="dialog-footer">
              <Button variant="outline" onClick={() => setPreview(undefined)}>
                {t('Cancelar')}
              </Button>
              <Button
                disabled={pending || blocked || backupUnavailable}
                onClick={() => {
                  setPreview(undefined);
                  void run(async () => {
                    await invoke('drive_upload', {
                      contents: JSON.stringify(preview),
                    });
                    onBackup();
                    try {
                      await list();
                    } catch (failure) {
                      setError(normalizeError(failure).message);
                    }
                  }, 'backup');
                }}
              >
                {t('Enviar backup')}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}

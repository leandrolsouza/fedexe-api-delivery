import { localizeNativeMessage } from '../lib/native-messages';
import { t } from '../lib/i18n';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { native, normalizeError } from '../lib/transport';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

type CheckResult =
  { status: 'unconfigured' | 'current' } | { status: 'available'; version: string };

export function useUpdates() {
  const [result, setResult] = useState<CheckResult>();
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [installError, setInstallError] = useState('');
  const [progress, setProgress] = useState('');
  const started = useRef(false);
  const operation = useRef(false);

  const check = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    setChecking(true);
    setResult(undefined);
    setError('');
    setInstallError('');
    try {
      const next = await invoke<CheckResult>('check_update');
      setResult(next);
      setOpen(next.status === 'available');
    } catch (failure) {
      setError(normalizeError(failure).message);
    } finally {
      operation.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!native || started.current) return;
    started.current = true;
    void check();
  }, [check]);

  async function install(blocked: boolean) {
    if (blocked || operation.current || result?.status !== 'available') return;
    operation.current = true;
    setInstallError('');
    setProgress(t('Baixando o instalador…'));
    const channel = new Channel<string>((message) => setProgress(localizeNativeMessage(message)));
    try {
      await invoke('install_update', { version: result.version, progress: channel });
    } catch (failure) {
      setInstallError(normalizeError(failure).message);
    } finally {
      operation.current = false;
      setProgress('');
    }
  }

  return {
    version: result?.status === 'available' ? result.version : undefined,
    status: checking
      ? t('Verificando atualizações…')
      : error ||
        (result?.status === 'current'
          ? t('Você está usando a versão estável mais recente.')
          : result?.status === 'unconfigured'
            ? t('O atualizador não está configurado neste instalador.')
            : ''),
    check,
    checking,
    open,
    setOpen,
    install,
    installError,
    progress,
  };
}

type Updates = ReturnType<typeof useUpdates>;

export function UpdateSettings({ updates }: { updates: Updates }) {
  if (!native) return null;
  return (
    <section className="surface settings-surface">
      <div className="settings-section-heading">
        <Download size={20} aria-hidden="true" />
        <div>
          <h3>{t('Atualizações')}</h3>
          <p>{t('Versões estáveis do Fedexe API para Windows.')}</p>
        </div>
      </div>
      <p role="status">
        {updates.version ? t('Versão {0} disponível.', updates.version) : updates.status}
      </p>
      <div className="settings-backup-actions">
        <Button variant="outline" disabled={updates.checking} onClick={() => void updates.check()}>
          {t('Verificar atualizações')}
        </Button>
        {updates.version && (
          <Button onClick={() => updates.setOpen(true)}>{t('Ver atualização')}</Button>
        )}
      </div>
    </section>
  );
}

export function UpdateDialog({ updates, blocked }: { updates: Updates; blocked: string }) {
  if (!updates.version) return null;
  return (
    <Dialog
      open={updates.open}
      onOpenChange={updates.setOpen}
      dismissible={!updates.progress}
      title={t('Versão {0} disponível', updates.version)}
      description={t(
        'O Fedexe vai verificar a assinatura do instalador, fechar e reabrir após a atualização.',
      )}
    >
      {blocked && <p role="status">{blocked}</p>}
      {updates.progress && <p role="status">{updates.progress}</p>}
      {updates.installError && <p role="alert">{updates.installError}</p>}
      <div className="dialog-footer">
        <Button
          variant="outline"
          disabled={!!updates.progress}
          onClick={() => updates.setOpen(false)}
        >
          {t('Adiar')}
        </Button>
        <Button
          disabled={!!(blocked || updates.progress)}
          onClick={() => void updates.install(!!blocked)}
        >
          {t('Instalar atualização')}
        </Button>
      </div>
    </Dialog>
  );
}

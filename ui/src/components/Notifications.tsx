import { useCallback, useEffect, useState } from 'react';
import { t, useLocale, type Message } from '../lib/i18n';
import { uid } from '../lib/utils';
import { PageHeading } from './WorkspaceViews';
import { Button } from './ui/button';

const labels = {
  update: 'Atualização {0} disponível',
  imported: 'Importação concluída',
  importFailed: 'Falha na importação',
  localBackup: 'Backup local exportado',
  backup: 'Backup enviado ao Google Drive',
  backupFailed: 'Falha no backup do Google Drive',
  restored: 'Backup restaurado',
  restoreFailed: 'Falha na restauração do backup',
} satisfies Record<string, Message>;

export type NoticeKind = keyof typeof labels;
export type Notice = {
  id: string;
  kind: NoticeKind;
  at: number;
  read: boolean;
  version?: string;
};

const key = 'fedexe.notifications.v1';
const limit = 100;

function load(): Notice[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(data)
      ? data
          .filter(
            (item) =>
              item &&
              typeof item.id === 'string' &&
              Object.hasOwn(labels, item.kind) &&
              Number.isFinite(item.at) &&
              Math.abs(item.at) <= 8.64e15 &&
              typeof item.read === 'boolean' &&
              (item.version === undefined || /^\d+\.\d+\.\d+$/.test(item.version)),
          )
          .slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

export function useNotifications() {
  const [items, setItems] = useState(load);
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {
      // The inbox remains available in memory when storage is unavailable.
    }
  }, [items]);
  const add = useCallback((kind: NoticeKind, version?: string) => {
    const id = kind === 'update' ? `update-${version}` : uid();
    const at = Date.now();
    setItems((current) =>
      current.some((item) => item.id === id)
        ? current
        : [{ id, kind, version, at, read: false }, ...current].slice(0, limit),
    );
    return id;
  }, []);
  const markRead = (id?: string) =>
    setItems((current) =>
      current.map((item) => (!id || item.id === id ? { ...item, read: true } : item)),
    );

  return { items, add, markRead };
}

export function Notifications({
  items,
  markRead,
  actionFor,
}: {
  items: Notice[];
  markRead: (id?: string) => void;
  actionFor: (notice: Notice) => (() => void) | undefined;
}) {
  const locale = useLocale();
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="workspace-page">
      <PageHeading
        title={t('Notificações')}
        description={t('Consulte atualizações e resultados das operações do workspace.')}
      />
      <section className="surface settings-surface">
        {items.some((item) => !item.read) && (
          <Button variant="outline" onClick={() => markRead()}>
            {t('Marcar todas como lidas')}
          </Button>
        )}
        {items.length ? (
          <ul className="drive-list">
            {items.map((item) => {
              const action = actionFor(item);
              return (
                <li key={item.id}>
                  <div>
                    <strong>{t(labels[item.kind], item.version ?? '')}</strong>
                    <div className="field-hint">
                      <time dateTime={new Date(item.at).toISOString()}>
                        {format.format(item.at)}
                      </time>
                      {!item.read && <span>{' · ' + t('Não lida')}</span>}
                    </div>
                  </div>
                  <div className="settings-backup-actions">
                    {!item.read && (
                      <Button variant="ghost" size="sm" onClick={() => markRead(item.id)}>
                        {t('Marcar como lida')}
                      </Button>
                    )}
                    {action && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          markRead(item.id);
                          action();
                        }}
                      >
                        {t('Abrir')}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>{t('Nenhuma notificação.')}</p>
        )}
      </section>
    </div>
  );
}

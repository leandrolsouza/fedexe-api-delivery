import { useEffect, useState } from 'react';
import {
  Box,
  Plus,
  Settings2,
  Search,
  ArrowDownToLine,
  Trash2,
  Pencil,
  MoreHorizontal,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeading } from './WorkspaceViews';
import { Button } from './ui/button';
import { Dropdown } from './ui/dropdown';
import { t, formatNumber, formatDate } from '../lib/i18n';
import {
  type WorkspaceSummary,
  workspaceLastOpened,
  readLocalWorkspace,
} from '../lib/local-workspaces';
import { type Workspace, loadWorkspace, exportableWorkspace } from '../lib/models';
import { download } from '../lib/utils';
import { normalizeError } from '../lib/transport';

type Entry = WorkspaceSummary & { collections?: number; requests?: number };
export function WorkspacesView({
  entries,
  current,
  workspace,
  native,
  onCreate,
  onOpen,
  onConfigure,
  onDelete,
  onRename,
  onDuplicate,
  duplicating,
  renaming,
  deleting,
}: {
  entries: WorkspaceSummary[];
  current: string;
  workspace: Workspace;
  native: boolean;
  onCreate: () => void;
  onOpen: (entry: WorkspaceSummary) => void;
  onConfigure: (entry: WorkspaceSummary) => void;
  onDelete: (entry: WorkspaceSummary) => void;
  onRename: (entry: WorkspaceSummary) => void;
  onDuplicate: (entry: WorkspaceSummary) => void;
  duplicating: boolean;
  renaming: boolean;
  deleting: boolean;
}) {
  const [query, setQuery] = useState('');
  const [details, setDetails] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    void Promise.all(
      entries.map(async (entry): Promise<Entry> => {
        try {
          const raw = await readLocalWorkspace(entry.id, native);
          if (!raw) return entry;
          const data = loadWorkspace(raw);
          return {
            ...entry,
            name: data.settings.workspaceName,
            collections: data.collections.length,
            requests: data.collections.reduce(
              (sum, collection) => sum + collection.requests.length,
              0,
            ),
          };
        } catch {
          return entry;
        }
      }),
    ).then((result) => {
      if (!disposed) {
        setDetails(result);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
    };
  }, [entries, native]);
  const name = (entry: Entry) => entry.name || t('Meu workspace');
  const rows = (loading ? entries : details)
    .map((entry) =>
      entry.id === current
        ? {
            ...entry,
            name: workspace.settings.workspaceName,
            collections: workspace.collections.length,
            requests: workspace.collections.reduce(
              (sum, collection) => sum + collection.requests.length,
              0,
            ),
          }
        : (entry as Entry),
    )
    .filter((entry) => name(entry).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  async function exportBackup(entry: Entry) {
    try {
      const raw = entry.id === current ? undefined : await readLocalWorkspace(entry.id, native);
      if (raw === null) throw new Error(t('O workspace selecionado não foi encontrado.'));
      const data = entry.id === current ? workspace : loadWorkspace(raw!);
      download('fedexe-backup.json', JSON.stringify(exportableWorkspace(data), null, 2));
    } catch (error) {
      toast.error(t('Não foi possível abrir o workspace. {0}', normalizeError(error).message));
    }
  }
  return (
    <div className="workspace-page workspaces-page">
      <PageHeading
        title={t('Workspaces')}
        description={t('Organize e abra seus workspaces locais.')}
      />
      {deleting && <p role="status">{t('Excluindo workspace…')}</p>}
      {renaming && <p role="status">{t('Renomeando workspace…')}</p>}
      {duplicating && <p role="status">{t('Duplicando workspace…')}</p>}
      <div className="workspaces-toolbar">
        <label className="workspaces-search">
          <Search size={16} />
          <input
            className="input"
            aria-label={t('Buscar workspaces')}
            placeholder={t('Buscar workspaces')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button onClick={onCreate}>
          <Plus size={16} /> {t('Novo workspace')}
        </Button>
      </div>
      <div className="surface workspaces-list" aria-busy={loading}>
        {rows.map((entry) => (
          <div className="workspace-row" key={entry.id}>
            <Box size={21} />
            <button className="workspace-row-open" onClick={() => onOpen(entry)}>
              <strong>{name(entry)}</strong>
              <span>
                {entry.collections === undefined
                  ? '—'
                  : `${formatNumber(entry.collections)} ${t('Coleções')} · ${formatNumber(entry.requests ?? 0)} ${t('Requisições')}`}
              </span>
            </button>
            <span className="workspace-last-opened">
              {t('Último acesso')}
              <br />
              {workspaceLastOpened(entry.id)
                ? formatDate(workspaceLastOpened(entry.id)!, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })
                : t('Ainda não aberto')}
            </span>
            {entry.id === current && (
              <span className="workspace-active">{t('Workspace ativo')}</span>
            )}
            <Dropdown
              trigger={
                <Button
                  variant="outline"
                  disabled={deleting || renaming || duplicating}
                  aria-label={t('Ações do workspace {0}', name(entry))}
                  title={t('Ações do workspace {0}', name(entry))}
                >
                  <MoreHorizontal size={18} />
                </Button>
              }
              items={[
                {
                  label: t('Configurar workspace'),
                  icon: <Settings2 size={15} />,
                  action: () => onConfigure(entry),
                },
                {
                  label: t('Renomear workspace'),
                  icon: <Pencil size={15} />,
                  action: () => onRename(entry),
                },
                {
                  label: t('Duplicar workspace'),
                  icon: <Copy size={15} />,
                  action: () => onDuplicate(entry),
                },
                {
                  label: t('Exportar backup'),
                  icon: <ArrowDownToLine size={15} />,
                  action: () => void exportBackup(entry),
                },
                {
                  label: t('Excluir workspace'),
                  icon: <Trash2 size={15} />,
                  danger: true,
                  separatorBefore: true,
                  action: () => onDelete(entry),
                },
              ]}
            />
          </div>
        ))}
        {!rows.length && <p className="small-empty">{t('Nenhum workspace encontrado.')}</p>}
      </div>
    </div>
  );
}

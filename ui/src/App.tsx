import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  BookOpen,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleHelp,
  Code2,
  Copy,
  FileJson2,
  Folder,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Globe2,
  HardDrive,
  History,
  Keyboard,
  Layers3,
  LoaderCircle,
  Maximize2,
  Minus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';
import { loadSecrets, saveSecrets, secretSnapshot } from './lib/credentials';
import {
  createWorkspace,
  compileRequest,
  emptyAuth,
  importCollection,
  isWorkspace,
  isEnvironment,
  loadWorkspace,
  newRequest,
  redactSecrets,
  safeWorkspace,
  exportableCollection,
  exportableWorkspace,
  safeEnvironment,
  STORAGE_KEY,
  syncUrl,
  variablesFor,
  type Auth,
  type Collection,
  type HistoryItem,
  type HttpResponse,
  type RequestItem,
  type RunResult,
  type View,
  type Workspace,
} from './lib/models';
import { cancel, native, normalizeError, releaseResponseBodies, send } from './lib/transport';
import { cn, download, uid } from './lib/utils';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { Dropdown } from './components/ui/dropdown';
import { curlFor, MethodBadge, RequestEditor } from './components/RequestEditor';
import {
  EnvironmentsView,
  HistoryView,
  RunnerView,
  SettingsView,
} from './components/WorkspaceViews';
import { CodeViewer } from './components/CodeViewer';
import { PairEditor } from './components/PairEditor';
import { AuthFields, AuthType } from './components/AuthFields';
import { version } from '../../package.json';
import { importPostman } from './lib/postman';
import { importCurl, isCurl } from './lib/curl';

type OpenTab = { collectionId: string; requestId: string };
type EditDialog = {
  title: string;
  description: string;
  initial: string;
  action: (name: string) => void;
};
type ConfirmDialog = { title: string; description: string; label: string; action: () => void };
const navigation = [
  { id: 'collections', label: 'Coleções', icon: Layers3 },
  { id: 'environments', label: 'Ambientes', icon: Globe2 },
  { id: 'runner', label: 'Runner de coleções', icon: Play },
  { id: 'history', label: 'Histórico', icon: History },
] as const;

async function initialState() {
  let raw: string | null = null;
  try {
    if (native) raw = await invoke<string | null>('load_workspace');
    raw ??= localStorage.getItem(STORAGE_KEY);
    const workspace = loadWorkspace(raw);
    if (native) await loadSecrets(workspace);
    return { workspace, error: '', raw: null };
  } catch (error) {
    return { workspace: createWorkspace(), error: normalizeError(error).message, raw };
  }
}

export function App() {
  const [initial, setInitial] = useState<Awaited<ReturnType<typeof initialState>>>();
  useEffect(() => {
    let disposed = false;
    void initialState().then((state) => {
      if (!disposed) setInitial(state);
    });
    return () => {
      disposed = true;
    };
  }, []);

  if (!initial) return <p role="status">Carregando workspace…</p>;
  return <WorkspaceApp initial={initial} />;
}

function WorkspaceApp({ initial }: { initial: Awaited<ReturnType<typeof initialState>> }) {
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const [storageBlocked, setStorageBlocked] = useState(!!initial.error);
  const [storageError, setStorageError] = useState(initial.error);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [persisted, setPersisted] = useState<Workspace>();
  const saveQueue = useRef(Promise.resolve());
  const [storedSecrets] = useState(() => secretSnapshot(initial.workspace));
  const [view, setView] = useState<View>('collections');
  const firstCollection = workspace.collections[0];
  const firstRequest =
    firstCollection?.requests.find((r) => r.id === 'list-users') || firstCollection?.requests[0];
  const [active, setActive] = useState<OpenTab>({
    collectionId: firstCollection?.id || '',
    requestId: firstRequest?.id || '',
  });
  const [tabs, setTabs] = useState<OpenTab[]>(
    firstRequest ? [{ collectionId: firstCollection.id, requestId: firstRequest.id }] : [],
  );
  const [drafts, setDrafts] = useState<Record<string, RequestItem>>({});
  const [responses, setResponses] = useState<Record<string, HttpResponse>>({});
  const responseBodies = useRef<string[]>([]);
  useEffect(() => {
    const current = new Set(
      Object.values(responses).flatMap(({ body_id }) => (body_id ? [body_id] : [])),
    );
    const released = responseBodies.current.filter((id) => !current.has(id));
    responseBodies.current = [...current];
    void releaseResponseBodies(released).catch((error) =>
      toast.error(normalizeError(error).message),
    );
  }, [responses]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sendingId, setSendingId] = useState('');
  const [sidebarHidden, setSidebarHidden] = useState(() => window.innerWidth <= 600);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [treeSearch, setTreeSearch] = useState('');
  const [showTreeSearch, setShowTreeSearch] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importReport, setImportReport] = useState<{ name: string; issues: string[] }>();
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [editDialog, setEditDialog] = useState<EditDialog>();
  const [editName, setEditName] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>();
  const [collectionSettings, setCollectionSettings] = useState<string>();
  const [moveRequest, setMoveRequest] = useState<{ collectionId: string; requestId: string }>();
  const [moveTarget, setMoveTarget] = useState('');
  const [dragged, setDragged] = useState<OpenTab>();
  const [lastRun, setLastRun] = useState<RunResult>();
  const [theme, setTheme] = useState('light');
  const fileInput = useRef<HTMLInputElement>(null);
  const collection = workspace.collections.find((c) => c.id === active.collectionId);
  const savedRequest = collection?.requests.find((r) => r.id === active.requestId);
  const request = drafts[active.requestId] || savedRequest;
  const dirty = !!request && JSON.stringify(request) !== JSON.stringify(savedRequest);
  const environment = workspace.environments.find((env) => env.id === workspace.activeEnvironment);
  const totalRequests = workspace.collections.reduce((sum, c) => sum + c.requests.length, 0);
  const saving = !storageBlocked && workspace !== persisted && !storageError;
  const hasPendingStorage =
    workspace !== persisted && (!storageBlocked || workspace !== initial.workspace);

  useEffect(() => {
    if (storageBlocked) return;
    let superseded = false;
    setStorageError('');
    saveQueue.current = saveQueue.current.then(async () => {
      if (superseded) return;
      try {
        const contents = JSON.stringify(safeWorkspace(workspace));
        if (native) {
          await saveSecrets(storedSecrets, secretSnapshot(workspace), () =>
            invoke('save_workspace', { contents }),
          );
        } else localStorage.setItem(STORAGE_KEY, contents);
        if (!superseded) setPersisted(workspace);
      } catch (error) {
        if (!superseded)
          setStorageError(`Não foi possível salvar o workspace. ${normalizeError(error).message}`);
      }
    });
    return () => {
      superseded = true;
    };
  }, [workspace, storageBlocked, storedSecrets, saveAttempt]);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const value =
        workspace.settings.theme === 'system'
          ? media.matches
            ? 'dark'
            : 'light'
          : workspace.settings.theme;
      document.documentElement.dataset.theme = value;
      setTheme(value);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [workspace.settings.theme]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(drafts).length || busy || hasPendingStorage) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts, busy, hasPendingStorage]);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const stop = await getCurrentWindow().onCloseRequested((event) => {
          if (!Object.keys(drafts).length && !busy && !hasPendingStorage) return;
          event.preventDefault();
          setConfirmDialog({
            title: 'Fechar o Fedexe?',
            description:
              'Há alterações pendentes ou uma execução ativa. Salve seu trabalho antes de fechar.',
            label: 'Fechar sem salvar',
            action: () => {
              void getCurrentWindow().destroy();
            },
          });
        });
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => toast.error(normalizeError(error).message));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [drafts, busy, hasPendingStorage]);

  const updateCollection = (id: string, update: (c: Collection) => Collection) =>
    setWorkspace((current) => ({
      ...current,
      collections: current.collections.map((c) => (c.id === id ? update(c) : c)),
    }));
  const openRequest = (collectionId: string, requestId: string) => {
    setActive({ collectionId, requestId });
    setTabs((current) =>
      current.some((t) => t.requestId === requestId)
        ? current
        : [...current, { collectionId, requestId }],
    );
    setView('collections');
  };
  const changeDraft = (item: RequestItem) =>
    setDrafts((current) => {
      const saved = workspace.collections.flatMap((c) => c.requests).find((r) => r.id === item.id);
      const next = { ...current };
      if (JSON.stringify(item) === JSON.stringify(saved)) delete next[item.id];
      else next[item.id] = item;
      return next;
    });
  const save = useCallback(() => {
    if (!request || !collection || !dirty) return;
    const item = syncUrl(request);
    setWorkspace((current) => ({
      ...current,
      collections: current.collections.map((c) =>
        c.id === collection.id
          ? { ...c, requests: c.requests.map((r) => (r.id === item.id ? item : r)) }
          : c,
      ),
    }));
    setDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }, [request, collection, dirty]);

  const sendRequest = useCallback(async () => {
    if (!request || !collection || busy) return;
    const item = syncUrl(request);
    setBusy(true);
    setSendingId(item.id);
    setErrors((current) => ({ ...current, [item.id]: '' }));
    let status: number | null = null;
    let duration = 0;
    let errorText: string | undefined;
    const start = performance.now();
    try {
      const compiled = compileRequest(item, collection, variablesFor(collection, environment));
      const response = await send(compiled);
      status = response.status;
      duration = response.duration_ms;
      setResponses((current) => ({ ...current, [item.id]: response }));
    } catch (error) {
      errorText = redactSecrets(normalizeError(error).message, environment);
      duration = Math.round(performance.now() - start);
      setErrors((current) => ({ ...current, [item.id]: errorText! }));
    } finally {
      setWorkspace((current) => ({
        ...current,
        history: [
          {
            id: uid(),
            name: item.name,
            method: item.method,
            url: item.url,
            status,
            duration,
            date: new Date().toISOString(),
            requestId: item.id,
            collectionId: collection.id,
            error: errorText,
          },
          ...current.history,
        ].slice(0, 300),
      }));
      setBusy(false);
      setSendingId('');
    }
  }, [request, collection, environment, busy]);

  const cancelExecution = () => {
    void cancel().catch((error) => toast.error(normalizeError(error).message));
  };
  const addRequest = useCallback(
    (collectionId?: string, folder = '') => {
      let target = collectionId || active.collectionId || workspace.collections[0]?.id;
      const item = newRequest(folder);
      if (!target) {
        target = uid();
        const c: Collection = {
          id: target,
          name: 'Minha coleção',
          description: '',
          folders: [],
          variables: [],
          auth: emptyAuth(),
          requests: [item],
        };
        setWorkspace((current) => ({ ...current, collections: [...current.collections, c] }));
      } else
        setWorkspace((current) => ({
          ...current,
          collections: current.collections.map((c) =>
            c.id === target ? { ...c, requests: [...c.requests, item] } : c,
          ),
        }));
      openRequest(target, item.id);
    },
    [active.collectionId, workspace.collections],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (view === 'collections') save();
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (view === 'collections') void sendRequest();
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        addRequest();
      }
      if (event.key === '\\') {
        event.preventDefault();
        setSidebarHidden((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save, sendRequest, addRequest, view]);

  function askName(
    title: string,
    description: string,
    initialName: string,
    action: (name: string) => void,
  ) {
    setEditName(initialName);
    setEditDialog({ title, description, initial: initialName, action });
  }
  function createCollection() {
    askName('Nova coleção', 'Um novo espaço para organizar suas APIs.', '', (name) => {
      const c: Collection = {
        id: uid(),
        name,
        description: '',
        folders: [],
        variables: [],
        auth: emptyAuth(),
        requests: [],
      };
      setWorkspace((current) => ({ ...current, collections: [...current.collections, c] }));
      setActive({ collectionId: c.id, requestId: '' });
      setView('collections');
    });
  }
  function createFolder(c: Collection) {
    askName('Nova pasta', `Organize as requisições de ${c.name}.`, '', (name) => {
      if (c.folders.includes(name)) {
        toast.error('Já existe uma pasta com esse nome.');
        return;
      }
      updateCollection(c.id, (current) => ({ ...current, folders: [...current.folders, name] }));
    });
  }
  function toggleCollapsed(key: string) {
    setCollapsed((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }
  function duplicateRequest(c: Collection, item: RequestItem) {
    const copy = {
      ...structuredClone(drafts[item.id] || item),
      id: uid(),
      name: `${item.name} (cópia)`,
    };
    updateCollection(c.id, (current) => ({ ...current, requests: [...current.requests, copy] }));
    openRequest(c.id, copy.id);
  }
  function reorder(c: Collection, item: RequestItem, direction: number) {
    const index = c.requests.findIndex((r) => r.id === item.id);
    const other = index + direction;
    if (other < 0 || other >= c.requests.length) return;
    updateCollection(c.id, (current) => {
      const requests = [...current.requests];
      const [moved] = requests.splice(index, 1);
      requests.splice(other, 0, moved);
      return { ...current, requests };
    });
  }
  function removeTabs(ids: string[]) {
    setTabs((current) => current.filter((t) => !ids.includes(t.requestId)));
    setResponses((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !ids.includes(key))),
    );
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !ids.includes(key))),
    );
    setDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !ids.includes(key))),
    );
    if (ids.includes(active.requestId)) {
      const next = tabs.find((t) => !ids.includes(t.requestId));
      setActive(next || { collectionId: active.collectionId, requestId: '' });
    }
  }
  function closeTab(tab: OpenTab) {
    const finish = () => removeTabs([tab.requestId]);
    if (drafts[tab.requestId])
      setConfirmDialog({
        title: 'Descartar alterações?',
        description: 'Esta requisição tem alterações que ainda não foram salvas.',
        label: 'Descartar e fechar',
        action: finish,
      });
    else finish();
  }
  function deleteRequest(c: Collection, item: RequestItem) {
    setConfirmDialog({
      title: 'Excluir requisição?',
      description: `“${item.name}” será removida da coleção ${c.name}.`,
      label: 'Excluir requisição',
      action: () => {
        updateCollection(c.id, (current) => ({
          ...current,
          requests: current.requests.filter((r) => r.id !== item.id),
        }));
        removeTabs([item.id]);
        toast.success('Requisição excluída', {
          action: {
            label: 'Desfazer',
            onClick: () =>
              updateCollection(c.id, (current) => ({
                ...current,
                requests: [...current.requests, item],
              })),
          },
        });
      },
    });
  }

  function collectionActions(c: Collection) {
    return [
      { label: 'Nova requisição', icon: <Plus size={14} />, action: () => addRequest(c.id) },
      { label: 'Nova pasta', icon: <FolderPlus size={14} />, action: () => createFolder(c) },
      {
        label: 'Renomear',
        icon: <Pencil size={14} />,
        action: () =>
          askName('Renomear coleção', 'Encontre o nome ideal para sua API.', c.name, (name) =>
            updateCollection(c.id, (current) => ({ ...current, name })),
          ),
      },
      {
        label: 'Variáveis e autorização da coleção',
        icon: <Braces size={14} />,
        action: () => setCollectionSettings(c.id),
      },
      {
        label: 'Duplicar coleção',
        icon: <Copy size={14} />,
        action: () => {
          const copy = {
            ...structuredClone(c),
            id: uid(),
            name: `${c.name} (cópia)`,
            requests: c.requests.map((r) => ({ ...r, id: uid() })),
          };
          setWorkspace((current) => ({ ...current, collections: [...current.collections, copy] }));
        },
      },
      {
        label: 'Exportar JSON',
        icon: <ArrowDownToLine size={14} />,
        action: () => download(`${c.name}.json`, JSON.stringify(exportableCollection(c), null, 2)),
      },
      {
        label: 'Excluir coleção',
        icon: <Trash2 size={14} />,
        danger: true,
        action: () =>
          setConfirmDialog({
            title: 'Excluir coleção?',
            description: `“${c.name}” e suas ${c.requests.length} requisições serão removidas.`,
            label: 'Excluir coleção',
            action: () => {
              setWorkspace((current) => ({
                ...current,
                collections: current.collections.filter((item) => item.id !== c.id),
              }));
              removeTabs(c.requests.map((r) => r.id));
              if (active.collectionId === c.id) setActive({ collectionId: '', requestId: '' });
            },
          }),
      },
    ];
  }

  function renderRequest(c: Collection, item: RequestItem) {
    const current = drafts[item.id] || item;
    if (
      treeSearch &&
      !`${current.name} ${current.method} ${current.url}`
        .toLowerCase()
        .includes(treeSearch.toLowerCase())
    )
      return null;
    return (
      <div
        className={cn(
          'tree-request',
          active.requestId === item.id && view === 'collections' && 'selected',
          dragged?.requestId === item.id && 'dragging',
        )}
        key={item.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          setDragged({ collectionId: c.id, requestId: item.id });
        }}
        onDragEnd={() => setDragged(undefined)}
        onDragOver={(e) => {
          if (dragged?.collectionId === c.id) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!dragged || dragged.collectionId !== c.id || dragged.requestId === item.id) return;
          updateCollection(c.id, (currentCollection) => {
            const requests = currentCollection.requests.filter((r) => r.id !== dragged.requestId);
            const moved = currentCollection.requests.find((r) => r.id === dragged.requestId);
            if (!moved) return currentCollection;
            requests.splice(
              requests.findIndex((r) => r.id === item.id),
              0,
              { ...moved, folder: item.folder },
            );
            return { ...currentCollection, requests };
          });
          setDragged(undefined);
        }}
      >
        <button
          className="tree-request-main"
          onClick={() => openRequest(c.id, item.id)}
          title={`${current.method} ${current.url}`}
        >
          <MethodBadge method={current.method} small />
          <span>{current.name}</span>
          {drafts[item.id] && <span className="dirty-dot" />}
        </button>
        <Dropdown
          trigger={
            <button className="tree-more" aria-label={`Ações de ${item.name}`}>
              <MoreHorizontal size={14} />
            </button>
          }
          items={[
            {
              label: 'Renomear',
              icon: <Pencil size={14} />,
              action: () =>
                askName('Renomear requisição', '', current.name, (name) => {
                  if (drafts[item.id]) changeDraft({ ...drafts[item.id], name });
                  else
                    updateCollection(c.id, (current) => ({
                      ...current,
                      requests: current.requests.map((r) =>
                        r.id === item.id ? { ...r, name } : r,
                      ),
                    }));
                }),
            },
            {
              label: 'Duplicar',
              icon: <Copy size={14} />,
              action: () => duplicateRequest(c, item),
            },
            {
              label: 'Mover para pasta',
              icon: <Folder size={14} />,
              action: () => {
                setMoveTarget(item.folder);
                setMoveRequest({ collectionId: c.id, requestId: item.id });
              },
            },
            {
              label: 'Mover para cima',
              icon: <ArrowUp size={14} />,
              action: () => reorder(c, item, -1),
            },
            {
              label: 'Mover para baixo',
              icon: <ArrowDown size={14} />,
              action: () => reorder(c, item, 1),
            },
            {
              label: 'Excluir',
              icon: <Trash2 size={14} />,
              danger: true,
              action: () => deleteRequest(c, item),
            },
          ]}
        />
      </div>
    );
  }

  function renderFolder(c: Collection, folder: string) {
    const key = `${c.id}:${folder}`;
    const requests = c.requests.filter((r) => r.folder === folder);
    const expanded = !!treeSearch || !collapsed.includes(key);
    return (
      <div className="tree-folder-group" key={folder}>
        <div className="tree-folder">
          <button
            className="tree-folder-main"
            onClick={() => toggleCollapsed(key)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? <FolderOpen size={15} /> : <FolderClosed size={15} />}
            <span>{folder}</span>
            <span className="tree-count">{requests.length}</span>
          </button>
          <Dropdown
            trigger={
              <button className="tree-more" aria-label={`Ações da pasta ${folder}`}>
                <MoreHorizontal size={14} />
              </button>
            }
            items={[
              {
                label: 'Nova requisição',
                icon: <Plus size={14} />,
                action: () => addRequest(c.id, folder),
              },
              {
                label: 'Renomear pasta',
                icon: <Pencil size={14} />,
                action: () =>
                  askName('Renomear pasta', '', folder, (name) => {
                    if (c.folders.includes(name) && name !== folder) {
                      toast.error('Já existe uma pasta com esse nome.');
                      return;
                    }
                    updateCollection(c.id, (current) => ({
                      ...current,
                      folders: current.folders.map((f) => (f === folder ? name : f)),
                      requests: current.requests.map((r) =>
                        r.folder === folder ? { ...r, folder: name } : r,
                      ),
                    }));
                    setDrafts((current) =>
                      Object.fromEntries(
                        Object.entries(current).map(([id, r]) => [
                          id,
                          c.requests.some((saved) => saved.id === id) && r.folder === folder
                            ? { ...r, folder: name }
                            : r,
                        ]),
                      ),
                    );
                  }),
              },
              {
                label: 'Duplicar pasta',
                icon: <Copy size={14} />,
                action: () => {
                  let name = `${folder} (cópia)`;
                  while (c.folders.includes(name)) name += ' (cópia)';
                  updateCollection(c.id, (current) => ({
                    ...current,
                    folders: [...current.folders, name],
                    requests: [
                      ...current.requests,
                      ...requests.map((r) => ({ ...structuredClone(r), id: uid(), folder: name })),
                    ],
                  }));
                },
              },
              {
                label: 'Excluir pasta',
                icon: <Trash2 size={14} />,
                danger: true,
                action: () =>
                  setConfirmDialog({
                    title: 'Excluir pasta e requisições?',
                    description: `A pasta “${folder}” e suas ${requests.length} requisições serão removidas.`,
                    label: 'Excluir pasta',
                    action: () => {
                      updateCollection(c.id, (current) => ({
                        ...current,
                        folders: current.folders.filter((f) => f !== folder),
                        requests: current.requests.filter((r) => r.folder !== folder),
                      }));
                      removeTabs(requests.map((r) => r.id));
                    },
                  }),
              },
            ]}
          />
        </div>
        {expanded && (
          <div className="folder-requests">
            {requests.map((item) => renderRequest(c, item))}
            {!requests.length && (
              <button className="empty-folder" onClick={() => addRequest(c.id, folder)}>
                <Plus size={12} /> Adicionar requisição
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  async function importData(text: string) {
    try {
      if (isCurl(text)) {
        const { request, issues } = importCurl(text);
        const destination = collection ?? workspace.collections[0];
        const id = destination?.id ?? uid();
        setWorkspace((current) => ({
          ...current,
          collections: destination
            ? current.collections.map((item) =>
                item.id === id ? { ...item, requests: [...item.requests, request] } : item,
              )
            : [
                ...current.collections,
                {
                  id,
                  name: 'Importações cURL',
                  description: '',
                  folders: [],
                  variables: [],
                  auth: emptyAuth(),
                  requests: [request],
                },
              ],
        }));
        openRequest(id, request.id);
        setImportReport({ name: request.name, issues });
        setImportOpen(false);
        setImportText('');
        setImportError('');
        return;
      }
      const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
      if (isWorkspace(parsed)) {
        setConfirmDialog({
          title: 'Restaurar backup?',
          description:
            'Este backup substituirá as coleções, ambientes e configurações atuais. Exporte seus dados antes de continuar.',
          label: 'Restaurar backup',
          action: () => {
            setWorkspace(parsed);
            setStorageBlocked(false);
            setDrafts({});
            setResponses({});
            setTabs([]);
            setActive({ collectionId: parsed.collections[0]?.id || '', requestId: '' });
            setImportOpen(false);
            toast.success('Backup restaurado');
          },
        });
        return;
      }
      const postman = importPostman(parsed);
      const environment =
        postman?.environment ??
        (isEnvironment(parsed) ? { ...safeEnvironment(parsed), id: uid() } : undefined);
      if (environment) {
        setWorkspace((current) => ({
          ...current,
          environments: [...current.environments, environment],
        }));
        setImportReport({ name: environment.name, issues: postman?.issues ?? [] });
        setImportOpen(false);
        setImportText('');
        setImportError('');
        setView('environments');
        return;
      }
      const c = postman?.collection ?? importCollection(parsed);
      if (postman) setImportReport({ name: c.name, issues: postman.issues });
      setWorkspace((current) => ({ ...current, collections: [...current.collections, c] }));
      setImportOpen(false);
      setImportText('');
      setImportError('');
      if (c.requests[0]) openRequest(c.id, c.requests[0].id);
      else setActive({ collectionId: c.id, requestId: '' });
      toast.success(`${c.name}: ${c.requests.length} requisições importadas`);
    } catch (error) {
      setImportError(normalizeError(error).message);
    }
  }

  function openHistory(row: HistoryItem) {
    if (
      workspace.collections.some(
        (c) => c.id === row.collectionId && c.requests.some((r) => r.id === row.requestId),
      )
    )
      openRequest(row.collectionId, row.requestId);
    else
      toast.info(
        'A requisição original não está mais na coleção. O histórico preserva apenas seus metadados.',
      );
  }
  async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
    if (action === 'close' && (Object.keys(drafts).length || busy || hasPendingStorage)) {
      setConfirmDialog({
        title: 'Fechar o Fedexe?',
        description:
          'Há alterações pendentes ou uma execução ativa. Salve seu trabalho antes de fechar.',
        label: 'Fechar sem salvar',
        action: () => {
          void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
            getCurrentWindow().destroy(),
          );
        },
      });
      return;
    }
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow()[action]();
    } catch (error) {
      toast.error(normalizeError(error).message);
    }
  }

  const settingsCollection = workspace.collections.find((c) => c.id === collectionSettings);
  const updateCollectionAuth = (auth: Auth) => {
    if (settingsCollection)
      updateCollection(settingsCollection.id, (current) => ({ ...current, auth }));
  };
  let snippet = '';
  try {
    if (request && collection) snippet = curlFor(request, collection, environment);
  } catch (error) {
    snippet = normalizeError(error).message;
  }
  const commandResults = workspace.collections
    .flatMap((c) => c.requests.map((r) => ({ collection: c, request: drafts[r.id] || r })))
    .filter(({ collection, request }) =>
      `${collection.name} ${request.name} ${request.method} ${request.url}`
        .toLowerCase()
        .includes(commandSearch.toLowerCase()),
    );

  return (
    <div
      className={cn(
        'app-shell',
        workspace.settings.compact && 'compact',
        sidebarHidden && 'sidebar-hidden',
        view !== 'collections' && 'wide-view',
      )}
    >
      <header className="app-header">
        <div className="header-brand" data-tauri-drag-region>
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M10 7h17l-3 6h-9l-2 4h9l-3 6h-9l-3 6H1z" fill="currentColor" />
            </svg>
          </span>
          <strong>
            fedexe<span>api</span>
          </strong>
          <span className="version-tag" aria-label={`Versão ${version}`}>
            {version}
          </span>
        </div>
        <div className="header-workspace">
          <span className="header-divider" />
          <Box size={15} />
          <span>{workspace.settings.workspaceName || 'Meu workspace'}</span>
          <Dropdown
            trigger={
              <button className="inline-icon" aria-label="Opções do workspace">
                <ChevronsUpDown size={12} />
              </button>
            }
            items={[
              {
                label: 'Configurar workspace',
                icon: <Settings2 size={14} />,
                action: () => setView('settings'),
              },
              {
                label: 'Exportar backup',
                icon: <ArrowDownToLine size={14} />,
                action: () =>
                  download(
                    'fedexe-backup.json',
                    JSON.stringify(exportableWorkspace(workspace), null, 2),
                  ),
              },
            ]}
          />
        </div>
        <button className="global-search" onClick={() => setCommandOpen(true)}>
          <Search size={15} />
          <span>Encontre qualquer coisa…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="header-right">
          <button className="documentation-button" onClick={() => setHelpOpen(true)}>
            <BookOpen size={14} />
            <span>Guia rápido</span>
            <ArrowUpRight size={12} />
          </button>
          <span className="header-divider" />
          <button
            className="header-help"
            aria-label="Novidades do projeto"
            title="Novidades do projeto"
            onClick={() => setHelpOpen(true)}
          >
            <Bell size={17} />
            <span />
          </button>
          <button
            className="profile-avatar"
            aria-label="Configurações do meu workspace"
            onClick={() => setView('settings')}
          >
            EU
          </button>
        </div>
        {native && (
          <div className="window-controls">
            <button aria-label="Minimizar janela" onClick={() => windowAction('minimize')}>
              <Minus size={15} />
            </button>
            <button
              aria-label="Maximizar ou restaurar janela"
              onClick={() => windowAction('toggleMaximize')}
            >
              <Maximize2 size={12} />
            </button>
            <button
              className="window-close"
              aria-label="Fechar janela"
              onClick={() => windowAction('close')}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </header>
      <nav className="navigation-rail" aria-label="Navegação principal">
        <div className="rail-top">
          {navigation.map((item) => (
            <button
              className={cn('rail-button', view === item.id && 'active')}
              aria-label={item.label}
              aria-current={view === item.id ? 'page' : undefined}
              title={item.label}
              onClick={() => setView(item.id)}
              key={item.id}
            >
              <item.icon size={20} strokeWidth={1.7} />
              {view === item.id && <span />}
            </button>
          ))}
        </div>
        <div className="rail-bottom">
          <button
            className={cn('rail-button', view === 'settings' && 'active')}
            aria-label="Configurações"
            aria-current={view === 'settings' ? 'page' : undefined}
            title="Configurações"
            onClick={() => setView('settings')}
          >
            <Settings2 size={20} strokeWidth={1.7} />
          </button>
          <button
            className="rail-button"
            aria-label="Atalhos de teclado"
            title="Atalhos de teclado"
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard size={20} strokeWidth={1.7} />
          </button>
          <div className="rail-bottom-divider" />
          <button
            className="rail-button help-rail-button"
            aria-label="Ajuda e primeiros passos"
            title="Ajuda"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={19} strokeWidth={1.7} />
          </button>
        </div>
      </nav>
      <aside className="collections-sidebar" aria-label="Árvore de coleções">
        <div className="sidebar-heading">
          <h2>
            Coleções <span>{workspace.collections.length}</span>
          </h2>
          <div>
            <button
              className="inline-icon"
              aria-label="Buscar nas coleções"
              title="Buscar nas coleções"
              onClick={() => setShowTreeSearch((v) => !v)}
            >
              <Search size={16} />
            </button>
            <button
              className="inline-icon"
              aria-label="Recolher painel de coleções"
              title="Recolher painel"
              onClick={() => setSidebarHidden(true)}
            >
              <PanelLeftClose size={16} />
            </button>
          </div>
        </div>
        <div className="sidebar-actions">
          <Dropdown
            trigger={
              <Button className="new-button" size="sm">
                <Plus size={15} /> Novo <ChevronDown size={12} />
              </Button>
            }
            items={[
              { label: 'Nova requisição', icon: <Zap size={14} />, action: () => addRequest() },
              { label: 'Nova coleção', icon: <Layers3 size={14} />, action: createCollection },
              {
                label: 'Nova pasta',
                icon: <FolderPlus size={14} />,
                disabled: !collection,
                action: () => collection && createFolder(collection),
              },
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setImportOpen(true);
              setImportError('');
            }}
          >
            <Upload size={13} /> Importar
          </Button>
        </div>
        {showTreeSearch && (
          <div className="sidebar-search search-field">
            <Search size={14} />
            <input
              autoFocus
              aria-label="Filtrar coleções"
              placeholder="Filtrar requisições…"
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
            />
            <button
              className="inline-icon"
              aria-label="Limpar busca"
              onClick={() => {
                setTreeSearch('');
                setShowTreeSearch(false);
              }}
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className="collection-tree">
          {workspace.collections.map((c) => (
            <div className="tree-collection-group" key={c.id}>
              <div className="tree-collection">
                <button
                  className="tree-collection-main"
                  aria-expanded={!!treeSearch || !collapsed.includes(c.id)}
                  onClick={() => {
                    toggleCollapsed(c.id);
                    setActive((current) =>
                      current.collectionId === c.id
                        ? current
                        : { collectionId: c.id, requestId: '' },
                    );
                  }}
                >
                  <ChevronDown
                    size={12}
                    className={collapsed.includes(c.id) && !treeSearch ? '-rotate-90' : ''}
                  />
                  <span className="collection-folder-icon">
                    <Layers3 size={16} />
                  </span>
                  <strong>{c.name}</strong>
                  <span className="tree-count">{c.requests.length}</span>
                </button>
                <Dropdown
                  trigger={
                    <button className="tree-more" aria-label={`Ações da coleção ${c.name}`}>
                      <MoreHorizontal size={15} />
                    </button>
                  }
                  items={collectionActions(c)}
                />
              </div>
              {(!collapsed.includes(c.id) || treeSearch) && (
                <div className="collection-contents">
                  {c.requests
                    .filter((r) => !r.folder || !c.folders.includes(r.folder))
                    .map((item) => renderRequest(c, item))}
                  {c.folders.map((folder) => renderFolder(c, folder))}
                  <button className="add-tree-request" onClick={() => addRequest(c.id)}>
                    <Plus size={13} /> Nova requisição
                  </button>
                </div>
              )}
            </div>
          ))}
          {!workspace.collections.length && (
            <div className="sidebar-empty">
              <Layers3 size={28} />
              <p>Sua próxima grande API começa aqui.</p>
              <Button variant="secondary" size="sm" onClick={createCollection}>
                Criar coleção
              </Button>
            </div>
          )}
        </div>
        <button className="runner-sidebar-link" onClick={() => setView('runner')}>
          <span>
            <Play size={13} fill="currentColor" />
          </span>
          <div>
            <strong>Runner de coleções</strong>
            <small>Seu fluxo, de ponta a ponta.</small>
          </div>
          <ArrowUpRight size={15} />
        </button>
        <div className="sidebar-local-card">
          <span className="local-card-art">
            <ShieldCheck size={21} />
          </span>
          <span className="local-card-label">SEU CÓDIGO. SEU ESPAÇO.</span>
          <h3>
            Local por natureza.
            <br />
            Livre por escolha.
          </h3>
          <p>
            Sem conta, sem nuvem obrigatória.
            <br />
            Só você e suas APIs.
          </p>
          <div>
            <span className="status-dot dot-green" /> Sempre no seu dispositivo{' '}
            <ArrowUpRight size={12} />
          </div>
        </div>
        <div className="sidebar-bottom">
          <span>
            <span className="status-dot dot-green" /> Workspace local
          </span>
          <HardDrive size={13} />
        </div>
      </aside>
      <main className="main-area">
        <div className="main-toolbar">
          <div className="breadcrumbs">
            {(sidebarHidden || view !== 'collections') && (
              <button
                className="inline-icon show-sidebar"
                aria-label="Mostrar coleções"
                onClick={() => {
                  setSidebarHidden(false);
                  setView('collections');
                }}
              >
                <PanelLeftOpen size={16} />
              </button>
            )}
            <span>
              {view === 'collections'
                ? 'Coleções'
                : view === 'environments'
                  ? 'Workspace'
                  : view === 'runner'
                    ? 'Ferramentas'
                    : view === 'history'
                      ? 'Workspace'
                      : 'Preferências'}
            </span>
            <ChevronRight size={12} />
            <span className={!request || view !== 'collections' ? 'breadcrumb-current' : ''}>
              {view === 'collections'
                ? collection?.name || 'Meu workspace'
                : view === 'environments'
                  ? 'Ambientes'
                  : view === 'runner'
                    ? 'Runner de coleções'
                    : view === 'history'
                      ? 'Histórico'
                      : 'Configurações'}
            </span>
            {view === 'collections' && request?.folder && (
              <>
                <ChevronRight size={12} />
                <span className="breadcrumb-current">{request.folder}</span>
              </>
            )}
          </div>
          <div className="main-toolbar-actions">
            <span className="local-first">
              <span className="status-dot dot-green" /> Local-first
            </span>
            <span className="toolbar-divider" />
            <div className="environment-picker">
              <Globe2 size={14} />
              <select
                aria-label="Ambiente ativo"
                value={workspace.activeEnvironment}
                disabled={busy}
                onChange={(e) =>
                  setWorkspace((current) => ({ ...current, activeEnvironment: e.target.value }))
                }
              >
                <option value="">Sem ambiente</option>
                {workspace.environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
              <span className={`status-dot dot-${environment?.color || 'green'}`} />
            </div>
            <button
              className="inline-icon"
              aria-label="Gerenciar ambientes"
              title="Gerenciar ambientes"
              onClick={() => setView('environments')}
            >
              <Settings2 size={15} />
            </button>
          </div>
        </div>
        {storageError && (
          <div className="storage-warning">
            <InfoIcon />
            <span>{storageError}</span>
            {!storageBlocked && (
              <button onClick={() => setSaveAttempt((attempt) => attempt + 1)}>
                Tentar salvar novamente
              </button>
            )}
            <button
              onClick={() =>
                download(
                  'fedexe-recuperacao.json',
                  storageBlocked && initial.raw !== null
                    ? initial.raw
                    : JSON.stringify(exportableWorkspace(workspace), null, 2),
                )
              }
            >
              Exportar dados
            </button>
            {storageBlocked && (
              <button
                onClick={() =>
                  setConfirmDialog({
                    title: 'Iniciar um novo workspace?',
                    description:
                      'Exporte os dados de recuperação antes de continuar. O armazenamento local será substituído por este workspace.',
                    label: 'Criar novo workspace',
                    action: () => {
                      setStorageBlocked(false);
                      setStorageError('');
                    },
                  })
                }
              >
                Começar de novo
              </button>
            )}
          </div>
        )}
        <div className="main-content">
          {view === 'collections' ? (
            <>
              <nav className="request-tabbar" aria-label="Requisições abertas">
                {tabs.map((tab) => {
                  const c = workspace.collections.find((c) => c.id === tab.collectionId);
                  const saved = c?.requests.find((r) => r.id === tab.requestId);
                  const item = drafts[tab.requestId] || saved;
                  return (
                    item && (
                      <div
                        className={cn(
                          'request-tab',
                          active.requestId === tab.requestId && 'active',
                        )}
                        key={tab.requestId}
                      >
                        <button
                          aria-current={active.requestId === tab.requestId ? 'page' : undefined}
                          onClick={() => setActive(tab)}
                        >
                          <MethodBadge method={item.method} small />
                          <span>{item.name}</span>
                          {drafts[item.id] && <span className="dirty-dot" />}
                        </button>
                        <button
                          className="close-tab"
                          aria-label={`Fechar aba ${item.name}`}
                          onClick={() => closeTab(tab)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  );
                })}
                <button
                  className="new-tab"
                  aria-label="Nova requisição"
                  title="Nova requisição (Ctrl N)"
                  onClick={() => addRequest()}
                >
                  <Plus size={17} />
                </button>
                <div className="tabbar-spacer" />
                <button className="tabbar-run" onClick={() => setView('runner')}>
                  <Play size={12} /> Executar coleção
                </button>
              </nav>
              {request && collection ? (
                <RequestEditor
                  key={request.id}
                  request={request}
                  collection={collection}
                  environment={environment}
                  onChange={changeDraft}
                  onSave={save}
                  dirty={dirty}
                  busy={busy && sendingId === request.id}
                  onSend={() => {
                    if (busy) toast.info('Aguarde a execução atual terminar.');
                    else void sendRequest();
                  }}
                  onCancel={cancelExecution}
                  response={responses[request.id]}
                  error={errors[request.id]}
                  onSnippet={() => setSnippetOpen(true)}
                  wrap={workspace.settings.wrap}
                />
              ) : (
                <div className="welcome-page">
                  <span className="welcome-kicker">
                    <Sparkles size={14} /> MENOS FRICÇÃO. MAIS CRIAÇÃO.
                  </span>
                  <div className="welcome-illustration">
                    <div />
                    <Layers3 size={54} strokeWidth={1.2} />
                    <span>
                      <Braces size={22} />
                    </span>
                  </div>
                  <h1>
                    Seu próximo grande projeto
                    <br />
                    começa com um request.
                  </h1>
                  <p>
                    Um espaço leve para criar, organizar e testar suas APIs.
                    <br />
                    No seu ritmo. No seu dispositivo.
                  </p>
                  <div className="welcome-actions">
                    <Button onClick={() => addRequest()}>
                      <Plus size={16} /> Nova requisição
                    </Button>
                    <Button variant="outline" onClick={() => setImportOpen(true)}>
                      <Upload size={15} /> Importar coleção
                    </Button>
                  </div>
                  <div className="welcome-features">
                    <span>
                      <ShieldCheck size={15} /> Local-first
                    </span>
                    <span>
                      <Zap size={15} /> Feito para ser leve
                    </span>
                    <span>
                      <Code2 size={15} /> Livre e open source
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : view === 'environments' ? (
            <EnvironmentsView workspace={workspace} onChange={setWorkspace} />
          ) : view === 'runner' ? null : view === 'history' ? (
            <HistoryView
              history={workspace.history}
              onOpen={openHistory}
              onClear={() => setWorkspace((current) => ({ ...current, history: [] }))}
            />
          ) : (
            <SettingsView
              workspace={workspace}
              onChange={setWorkspace}
              onImport={() => setImportOpen(true)}
              onHelp={() => setHelpOpen(true)}
            />
          )}
          <div hidden={view !== 'runner'}>
            <RunnerView
              workspace={workspace}
              busy={busy}
              setBusy={setBusy}
              onCancel={cancelExecution}
              onResults={setLastRun}
            />
          </div>
        </div>
      </main>
      <footer className="app-statusbar">
        <div>
          <span className="statusbar-brand">
            <Zap size={12} fill="currentColor" /> Fedexe API
          </span>
          <span className="statusbar-separator" />
          <span>
            <span
              className={cn('status-dot', storageError || saving ? 'dot-amber' : 'dot-green')}
            />
            {storageError
              ? 'Verifique o armazenamento'
              : saving
                ? 'Salvando workspace…'
                : 'Todos os dados neste dispositivo'}
          </span>
        </div>
        <div>
          {busy ? (
            <span>
              <LoaderCircle size={12} className="spin" /> Executando…
            </span>
          ) : (
            lastRun && (
              <span>
                <Check size={12} /> Última rodada: {lastRun.results.length} etapas
              </span>
            )
          )}
          <span>{totalRequests} requisições</span>
          <span className="statusbar-separator" />
          <span>{native ? 'Rust + Tauri' : 'Modo navegador'}</span>
          <button onClick={() => setShortcutsOpen(true)}>
            <Keyboard size={12} /> Atalhos
          </button>
        </div>
      </footer>

      <Dialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title="Encontre seu próximo passo"
        description="Busque uma requisição ou navegue pelo workspace."
        className="command-dialog"
      >
        <div className="command-input">
          <Search size={20} />
          <input
            autoFocus
            aria-label="Buscar em todo o workspace"
            placeholder="Digite um nome, endpoint ou comando…"
            value={commandSearch}
            onChange={(e) => setCommandSearch(e.target.value)}
          />
        </div>
        <div className="command-results">
          <span className="command-group-label">REQUISIÇÕES</span>
          {commandResults.slice(0, 20).map(({ collection, request }) => (
            <button
              key={request.id}
              onClick={() => {
                openRequest(collection.id, request.id);
                setCommandOpen(false);
                setCommandSearch('');
              }}
            >
              <MethodBadge method={request.method} small />
              <span>
                <strong>{request.name}</strong>
                <small>
                  {collection.name} {request.folder && ` / ${request.folder}`}
                </small>
              </span>
              <ArrowUpRight size={14} />
            </button>
          ))}
          {!commandResults.length && <p className="small-empty">Nenhuma requisição encontrada.</p>}
          <span className="command-group-label">NAVEGAR</span>
          {navigation
            .filter((n) => n.label.toLowerCase().includes(commandSearch.toLowerCase()))
            .map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setView(n.id);
                  setCommandOpen(false);
                }}
              >
                <n.icon size={17} />
                <span>{n.label}</span>
                <ArrowRight size={14} />
              </button>
            ))}
        </div>
        <div className="command-footer">
          <span>
            <kbd>Tab</kbd> para navegar
          </span>
          <span>
            <kbd>Enter</kbd> para abrir
          </span>
          <span>
            <kbd>Esc</kbd> para fechar
          </span>
        </div>
      </Dialog>
      <Dialog
        open={!!editDialog}
        onOpenChange={(open) => {
          if (!open) setEditDialog(undefined);
        }}
        title={editDialog?.title || ''}
        description={editDialog?.description}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!editName.trim() || !editDialog) return;
            editDialog.action(editName.trim());
            setEditDialog(undefined);
          }}
        >
          <label className="field-label">
            Nome
            <input
              className="input"
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              maxLength={100}
              placeholder="Um nome fácil de encontrar"
            />
          </label>
          <div className="dialog-footer">
            <Button type="button" variant="outline" onClick={() => setEditDialog(undefined)}>
              Cancelar
            </Button>
            <Button type="submit">
              {editDialog?.initial ? 'Salvar nome' : 'Criar'} <ArrowRight size={14} />
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={!!confirmDialog}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(undefined);
        }}
        title={confirmDialog?.title || ''}
        description={confirmDialog?.description}
      >
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setConfirmDialog(undefined)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              confirmDialog?.action();
              setConfirmDialog(undefined);
            }}
          >
            {confirmDialog?.label}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Traga suas APIs para casa."
        description="Importe um backup, uma coleção, um ambiente Postman ou uma requisição cURL."
        className="import-dialog"
      >
        <button
          className="import-dropzone"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) {
              if (file.size > 10 * 1024 * 1024) {
                setImportError('O arquivo excede o limite de importação de 10 MB.');
                return;
              }
              const text = await file.text();
              setImportText(text);
              await importData(text);
            }
          }}
        >
          <span>
            <Upload size={25} />
          </span>
          <strong>Arraste seu arquivo ou clique para escolher</strong>
          <small>Arquivos .json · até 10 MB</small>
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.size > 10 * 1024 * 1024) {
              setImportError('O arquivo excede o limite de importação de 10 MB.');
              return;
            }
            try {
              const text = await file.text();
              setImportText(text);
              await importData(text);
            } catch (error) {
              setImportError(normalizeError(error).message);
            }
          }}
        />
        <div className="import-divider">
          <span />
          ou cole JSON ou cURL
          <span />
        </div>
        <textarea
          aria-label="JSON da coleção para importar"
          className="input mono import-textarea"
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
            setImportError('');
          }}
          placeholder={
            '{\n  "variables": { "base_url": "http://localhost:3000" },\n  "requests": []\n}'
          }
          spellCheck={false}
        />
        {importError && <div className="inline-error">{importError}</div>}
        <div className="import-formats">
          <span>
            <FileJson2 size={15} /> Fedexe JSON <Check size={12} />
          </span>
          <span>Postman · cURL</span>
        </div>
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setImportOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={!importText.trim()} onClick={() => importData(importText)}>
            {isCurl(importText) ? 'Importar cURL' : 'Importar JSON'} <ArrowRight size={14} />
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!importReport}
        onOpenChange={(open) => {
          if (!open) setImportReport(undefined);
        }}
        title="Relatório de importação"
        description={importReport?.name ?? ''}
      >
        {importReport?.issues.length ? (
          <ul className="import-report">
            {importReport.issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        ) : (
          <p>Nenhum ajuste identificado na importação.</p>
        )}
        <div className="dialog-footer">
          <Button onClick={() => setImportReport(undefined)}>Concluir</Button>
        </div>
      </Dialog>
      <Dialog
        open={snippetOpen}
        onOpenChange={setSnippetOpen}
        title="Do seu workspace para o terminal."
        description="Comando cURL para a requisição atual. Placeholders são preservados; revise os valores antes de compartilhar."
        className="snippet-dialog"
      >
        <div className="snippet-language">
          <Terminal size={15} /> Shell · cURL <span className="subtle-badge">bash</span>
        </div>
        <CodeViewer value={snippet} json={false} />
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setSnippetOpen(false)}>
            Fechar
          </Button>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(snippet);
                toast.success('cURL copiado');
              } catch {
                toast.error('Não foi possível copiar. Selecione o texto manualmente.');
              }
            }}
          >
            <Copy size={14} /> Copiar código
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        title="Seu fluxo, na ponta dos dedos."
        description="Pequenos atalhos. Grandes diferenças."
        className="shortcuts-dialog"
      >
        <div className="shortcut-list">
          {[
            { label: 'Buscar em todo o workspace', keys: ['Ctrl', 'K'] },
            { label: 'Enviar requisição', keys: ['Ctrl', 'Enter'] },
            { label: 'Salvar requisição', keys: ['Ctrl', 'S'] },
            { label: 'Nova requisição', keys: ['Ctrl', 'N'] },
            { label: 'Alternar painel de coleções', keys: ['Ctrl', '\\'] },
            { label: 'Fechar diálogo', keys: ['Esc'] },
          ].map((shortcut) => (
            <div key={shortcut.label}>
              <span>{shortcut.label}</span>
              <div>
                {shortcut.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="shortcut-note">
          <Keyboard size={15} /> No macOS, use ⌘ no lugar de Ctrl.
        </div>
      </Dialog>
      <Dialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Olá, mundo. Olá, Fedexe."
        description="Seu cliente de APIs local, gratuito e feito para manter o foco no que importa."
        className="help-dialog"
      >
        <div className="help-hero">
          <span className="brand-mark">
            <Zap size={26} fill="currentColor" />
          </span>
          <div>
            <strong>Construir APIs pode ser mais leve.</strong>
            <p>Explore a coleção Acme API para conhecer seu novo workspace.</p>
          </div>
        </div>
        <div className="help-steps">
          <div>
            <span>01</span>
            <div>
              <h4>Inicie a API de exemplo</h4>
              <p>Na pasta do projeto, execute:</p>
              <code>node tools/test-server.mjs</code>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <h4>Envie seu primeiro request</h4>
              <p>Abra “Listar usuários”, escolha o ambiente Local e clique em Enviar.</p>
            </div>
          </div>
          <div>
            <span>03</span>
            <div>
              <h4>Teste o fluxo completo</h4>
              <p>
                O runner obtém um token e o reutiliza nas etapas seguintes. Tudo fica isolado por
                rodada.
              </p>
            </div>
          </div>
        </div>
        <div className="dialog-footer">
          <Button
            variant="outline"
            onClick={() => {
              setHelpOpen(false);
              setShortcutsOpen(true);
            }}
          >
            <Keyboard size={14} /> Ver atalhos
          </Button>
          <Button
            onClick={() => {
              setHelpOpen(false);
              setView('collections');
            }}
          >
            Vamos construir <ArrowRight size={14} />
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!collectionSettings}
        onOpenChange={(open) => {
          if (!open) setCollectionSettings(undefined);
        }}
        title={`Variáveis e autorização · ${settingsCollection?.name || ''}`}
        description="Defina as variáveis e a autorização que os endpoints podem herdar."
        className="collection-settings-dialog"
      >
        {settingsCollection && (
          <>
            <PairEditor
              kind="variável"
              rows={settingsCollection.variables}
              onChange={(variables) =>
                updateCollection(settingsCollection.id, (current) => ({ ...current, variables }))
              }
            />
            <div className="collection-auth-settings auth-fields">
              <AuthType auth={settingsCollection.auth} onChange={updateCollectionAuth} />
              <AuthFields auth={settingsCollection.auth} onChange={updateCollectionAuth} />
            </div>
            <div className="dialog-footer">
              <span className="muted">Alterações salvas automaticamente</span>
              <Button onClick={() => setCollectionSettings(undefined)}>
                Concluir <Check size={14} />
              </Button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog
        open={!!moveRequest}
        onOpenChange={(open) => {
          if (!open) setMoveRequest(undefined);
        }}
        title="Cada request no seu lugar."
        description="Escolha a pasta de destino dentro da coleção."
      >
        <label className="field-label">
          Pasta
          <select
            className="input"
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
          >
            <option value="">Raiz da coleção</option>
            {workspace.collections
              .find((c) => c.id === moveRequest?.collectionId)
              ?.folders.map((f) => (
                <option key={f}>{f}</option>
              ))}
          </select>
        </label>
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setMoveRequest(undefined)}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (!moveRequest) return;
              updateCollection(moveRequest.collectionId, (current) => ({
                ...current,
                requests: current.requests.map((r) =>
                  r.id === moveRequest.requestId ? { ...r, folder: moveTarget } : r,
                ),
              }));
              if (drafts[moveRequest.requestId])
                changeDraft({ ...drafts[moveRequest.requestId], folder: moveTarget });
              setMoveRequest(undefined);
            }}
          >
            Mover requisição <ArrowRight size={14} />
          </Button>
        </div>
      </Dialog>
      <Toaster
        position="bottom-right"
        theme={theme === 'dark' ? 'dark' : 'light'}
        richColors
        closeButton
      />
    </div>
  );
}

function InfoIcon() {
  return <ShieldCheck size={16} />;
}

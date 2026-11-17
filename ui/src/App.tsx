import { DriveBackups } from './components/DriveBackups';
import { Notifications, useNotifications, type Notice } from './components/Notifications';
import { PostmanWorkspaceDialog } from './components/PostmanWorkspaceDialog';
import type { PostmanImport } from './lib/postman-workspace';
import { formatNumber, t, useLocale } from './lib/i18n';
import { resolveTheme, themes, type ColorScheme } from './lib/themes';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Bell,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
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
import { createWorkspaceAutosave } from './lib/workspace-autosave';
import {
  lastActiveWorkspace,
  listLocalWorkspaces,
  originalWorkspaceId,
  readLocalWorkspace,
  rememberActiveWorkspace,
  writeLocalWorkspace,
  type WorkspaceSummary,
} from './lib/local-workspaces';
import {
  inspectRestoredBackup,
  replaceBackupAttachment,
  type BackupAttachment,
  type BackupRestoreReport,
} from './lib/backup-restore';
import { loadSecrets, type StoredSecrets } from './lib/credentials';
import {
  createEmptyWorkspace,
  createWorkspace,
  addConsoleMasks,
  compileRequest,
  emptyAuth,
  loadWorkspace,
  newRequest,
  RequestResolutionError,
  redactValues,
  redactUrlCredentials,
  exportableCollection,
  exportableWorkspace,
  syncUrl,
  variablesFor,
  type Auth,
  type Collection,
  type Pair,
  type HistoryItem,
  type HttpResponse,
  type RequestItem,
  type RunResult,
  type View,
  type Workspace,
} from './lib/models';
import {
  cancel,
  native,
  normalizeError,
  pickBodyFile,
  releaseResponseBodies,
  send,
  sendScriptRequest,
} from './lib/transport';
import {
  consoleAttemptFactory,
  postResponseTrace,
  selectRequestConsole,
} from './lib/request-console';
import { RequestConsole } from './components/RequestConsole';
import { cn, download, uid } from './lib/utils';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { UpdateDialog, UpdateSettings, useUpdates } from './components/Updates';
import { Dropdown } from './components/ui/dropdown';
import {
  curlFor,
  MethodBadge,
  maxRequestShare,
  minRequestShare,
  RequestEditor,
  type RequestLayout,
} from './components/RequestEditor';
import {
  EnvironmentsView,
  HistoryView,
  RunnerView,
  SettingsView,
  type RunnerFolder,
} from './components/WorkspaceViews';
import { CodeViewer } from './components/CodeViewer';
import { runScripts, type ScriptResult } from './lib/scripts';
import { PairEditor } from './components/PairEditor';
import { AuthFields, AuthType } from './components/AuthFields';
import { version } from '../../package.json';
import { importDocument, importFileBatch, readImportFile } from './lib/import-files';
import { importCurl, isCurl } from './lib/curl';
import { navigateTabs } from './lib/keyboard';
import {
  FOLDER_SEPARATOR,
  canRelocateFolder,
  folderPath,
  indexFolders,
  isInFolder,
} from './lib/folders';

type OpenTab = { collectionId: string; requestId: string; bodyShortcut?: string };
const ScriptEditor = lazy(() => import('./components/ScriptEditor'));
const collectionSettingsTabs = ['Variáveis', 'Autorização', 'Scripts'] as const;
type EditDialog = {
  title: string;
  description: string;
  initial: string;
  action: (name: string) => void;
};
type ConfirmDialog = { title: string; description: string; label: string; action: () => void };
const driveEnabled = native && import.meta.env.VITE_FEDEXE_GOOGLE_DRIVE === 'true';
const editorPreferencesKey = 'fedexe.editor-layout.v1';

function loadEditorPreferences(): { layout: RequestLayout; requestShare: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(editorPreferencesKey) ?? 'null');
    return {
      layout: saved?.layout === 'request' || saved?.layout === 'response' ? saved.layout : 'split',
      requestShare:
        Number.isInteger(saved?.requestShare) &&
        saved.requestShare >= minRequestShare &&
        saved.requestShare <= maxRequestShare
          ? saved.requestShare
          : 50,
    };
  } catch {
    return { layout: 'split', requestShare: 50 };
  }
}
const navigationItems = [
  { id: 'collections', label: 'Coleções', icon: Layers3 },
  { id: 'environments', label: 'Ambientes', icon: Globe2 },
  { id: 'runner', label: 'Runner de coleções', icon: Play },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'console', label: 'Console de requisições', icon: Terminal },
  { id: 'drive', label: 'Backups no Google Drive', icon: HardDrive },
] as const;

async function initialState(workspaceId: string) {
  let workspace: Workspace | undefined;
  try {
    const raw = await readLocalWorkspace(workspaceId, native);
    if (raw === null && workspaceId !== originalWorkspaceId)
      throw new Error(t('O workspace selecionado não foi encontrado.'));
    workspace = loadWorkspace(raw);
    return {
      ...(await loadSecrets(workspace, native)),
      workspaceId,
      error: '',
      recovery: undefined,
    };
  } catch (error) {
    return {
      workspace: workspaceId === originalWorkspaceId ? createWorkspace() : createEmptyWorkspace(''),
      workspaceId,
      storedSecrets: new Map() as StoredSecrets,
      retiredSecrets: [],
      error: normalizeError(error).message,
      recovery: workspace && exportableWorkspace(workspace),
    };
  }
}

type InitialWorkspace = Awaited<ReturnType<typeof initialState>>;

export function App() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const [initial, setInitial] = useState<InitialWorkspace>();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [switching, setSwitching] = useState(false);
  const switchPending = useRef(false);
  useEffect(() => {
    let disposed = false;
    async function openLastWorkspace() {
      const available = await listLocalWorkspaces(native).catch(() => [
        { id: originalWorkspaceId, name: null },
      ]);
      const preferred = lastActiveWorkspace();
      const id = available.some((entry) => entry.id === preferred)
        ? preferred
        : originalWorkspaceId;
      const state = await initialState(id);
      if (disposed) return;
      selectRequestConsole(id);
      setWorkspaces(available);
      setInitial(state);
    }
    void openLastWorkspace();
    return () => {
      disposed = true;
    };
  }, []);

  async function changeWorkspace(
    current: WorkspaceSummary,
    next: WorkspaceSummary,
    create = false,
  ) {
    if (switchPending.current || current.id === next.id) return;
    switchPending.current = true;
    setSwitching(true);
    try {
      if (create) {
        const workspace = createEmptyWorkspace(next.name ?? '');
        await writeLocalWorkspace(next.id, JSON.stringify(workspace), native);
      }
      const state = await initialState(next.id);
      if (state.error) throw new Error(state.error);
      try {
        rememberActiveWorkspace(next.id);
      } catch (error) {
        toast.error(
          t('Não foi possível lembrar o workspace ativo. {0}', normalizeError(error).message),
        );
      }
      selectRequestConsole(next.id);
      setWorkspaces((entries) => [
        ...entries.map((entry) => (entry.id === current.id ? current : entry)),
        ...(create ? [next] : []),
      ]);
      setInitial(state);
    } catch (error) {
      toast.error(t('Não foi possível abrir o workspace. {0}', normalizeError(error).message));
    } finally {
      switchPending.current = false;
      setSwitching(false);
    }
  }

  if (!initial) return <p role="status">{t('Carregando workspace…')}</p>;
  return (
    <WorkspaceApp
      key={initial.workspaceId}
      initial={initial}
      workspaces={workspaces}
      switching={switching}
      changeWorkspace={changeWorkspace}
    />
  );
}

function WorkspaceApp({
  initial,
  workspaces,
  switching,
  changeWorkspace,
}: {
  initial: InitialWorkspace;
  workspaces: WorkspaceSummary[];
  switching: boolean;
  changeWorkspace: (
    current: WorkspaceSummary,
    next: WorkspaceSummary,
    create?: boolean,
  ) => Promise<void>;
}) {
  const updates = useUpdates();
  const { items, markRead, add: addNotice } = useNotifications();
  const notices = driveEnabled
    ? items
    : items.filter(({ kind }) => kind !== 'backup' && kind !== 'backupFailed');
  const unread = notices.filter((notice) => !notice.read).length;
  useEffect(() => {
    if (updates.version) addNotice('update', updates.version);
  }, [updates.version, addNotice]);
  const navigation = navigationItems
    .filter((item) => (item.id === 'drive' ? driveEnabled : item.id !== 'console' || native))
    .map((item) => ({ ...item, label: t(item.label) }));
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const { defaultTimeoutMs, defaultRedirectPolicy } = workspace.settings;
  const [storageBlocked, setStorageBlocked] = useState(!!initial.error);
  const [storageError, setStorageError] = useState(initial.error);
  useEffect(() => {
    if (storageError)
      toast.error(storageError, { id: 'workspace-storage-error', duration: Infinity });
    return () => {
      toast.dismiss('workspace-storage-error');
    };
  }, [storageError]);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [persisted, setPersisted] = useState<Workspace>();
  const [autosave] = useState(() => createWorkspaceAutosave({ ...initial, native }));
  const [view, setView] = useState<View>('collections');
  const [{ layout: requestLayout, requestShare }, setEditorPreferences] =
    useState(loadEditorPreferences);
  const setRequestLayout = (layout: RequestLayout) =>
    setEditorPreferences((current) =>
      layout === current.layout ? current : { ...current, layout },
    );
  const setRequestShare = (requestShare: number) =>
    setEditorPreferences((current) =>
      requestShare === current.requestShare ? current : { ...current, requestShare },
    );
  useEffect(() => {
    try {
      localStorage.setItem(
        editorPreferencesKey,
        JSON.stringify({ layout: requestLayout, requestShare }),
      );
    } catch {
      // The editor remains usable if browser storage is unavailable.
    }
  }, [requestLayout, requestShare]);
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
  useEffect(
    () => () => {
      void releaseResponseBodies(responseBodies.current).catch((error) =>
        toast.error(normalizeError(error).message),
      );
    },
    [],
  );
  const [scriptResults, setScriptResults] = useState<Record<string, ScriptResult[]>>({});
  const scriptSessions = useRef(new Map<string, Map<string, string | null>>());
  const manualExecution = useRef<AbortController>(undefined);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [sendingId, setSendingId] = useState('');
  const [sidebarHidden, setSidebarHidden] = useState(() => window.innerWidth <= 600);
  const [sidebarWidth, setSidebarWidth] = useState<number>();
  const sidebarDrag = useRef<{ x: number; width: number }>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [renderedSidebarWidth, setRenderedSidebarWidth] = useState(252);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const observer = new ResizeObserver(() => {
      const width = sidebar.getBoundingClientRect().width;
      if (width > 0) setRenderedSidebarWidth(Math.round(width));
    });
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);
  const resizeSidebar = (width: number) =>
    setSidebarWidth(Math.round(Math.max(180, Math.min(440, window.innerWidth * 0.4, width))));
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [treeMenu, setTreeMenu] = useState<string>();
  const [runnerFolder, setRunnerFolder] = useState<RunnerFolder>();
  const [treeSearch, setTreeSearch] = useState('');
  const [showTreeSearch, setShowTreeSearch] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [postmanOpen, setPostmanOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importingFiles, setImportingFiles] = useState(false);
  type ImportReport = { name: string; issues: string[]; entries?: string[] };
  const [importReport, setImportReport] = useState<ImportReport>();
  const [importReports, setImportReports] = useState<Record<string, ImportReport>>({});
  const restoring = useRef(false);
  const restoreNotice = useRef<string>(undefined);
  const restoreInspection = useRef(0);
  const [restoreReport, setRestoreReport] = useState<BackupRestoreReport>();
  const showRestoreReport = useCallback(async (snapshot: Workspace, onlyWithIssues: boolean) => {
    const inspection = ++restoreInspection.current;
    const report = await inspectRestoredBackup(
      snapshot,
      native
        ? (paths) => invoke<(boolean | null)[]>('check_backup_attachments', { paths })
        : undefined,
    );
    if (
      inspection === restoreInspection.current &&
      (!onlyWithIssues || report.attachments.length || report.secrets.length)
    )
      setRestoreReport(report);
  }, []);

  function showImportReport(report: ImportReport, failed = false) {
    const id = addNotice(failed ? 'importFailed' : 'imported');
    setImportReports((current) =>
      Object.fromEntries([[id, report], ...Object.entries(current).slice(0, 99)]),
    );
    setImportReport(report);
  }
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [editDialog, setEditDialog] = useState<EditDialog>();
  const [editName, setEditName] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog>();
  const [collectionSettings, setCollectionSettings] = useState<string>();
  const [collectionSettingsTab, setCollectionSettingsTab] =
    useState<(typeof collectionSettingsTabs)[number]>('Variáveis');
  const [collectionScriptsExpanded, setCollectionScriptsExpanded] = useState(false);
  const [moveRequest, setMoveRequest] = useState<{ collectionId: string; requestId: string }>();
  const [moveTarget, setMoveTarget] = useState('');
  const [moveFolder, setMoveFolder] = useState<{
    collectionId: string;
    path: string;
    label: string;
  }>();
  const [moveFolderTarget, setMoveFolderTarget] = useState<string>();
  const moveFolderCollection = workspace.collections.find((c) => c.id === moveFolder?.collectionId);
  const moveFolderDestinations =
    moveFolder && moveFolderCollection
      ? ['', ...moveFolderCollection.folders].filter(
          (parent) =>
            !isInFolder(parent, moveFolder.path) &&
            canRelocateFolder(
              moveFolderCollection.folders,
              moveFolder.path,
              folderPath(parent, moveFolder.label),
            ),
        )
      : [];
  const moveFolderDestination =
    moveFolderTarget !== undefined && moveFolderDestinations.includes(moveFolderTarget)
      ? moveFolderTarget
      : moveFolderDestinations[0];
  const [dragged, setDragged] = useState<OpenTab>();
  const [lastRun, setLastRun] = useState<RunResult>();
  const [systemScheme, setSystemScheme] = useState<ColorScheme>(() =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const palette = resolveTheme(workspace.settings, systemScheme);
  const theme = themes[palette].scheme;
  const fileInput = useRef<HTMLInputElement>(null);
  const collection = workspace.collections.find((c) => c.id === active.collectionId);
  const savedRequest = collection?.requests.find((r) => r.id === active.requestId);
  const request = drafts[active.requestId] || savedRequest;
  const dirty = !!request && JSON.stringify(request) !== JSON.stringify(savedRequest);
  const environment = workspace.environments.find((env) => env.id === workspace.activeEnvironment);
  const variableSession = collection
    ? scriptSessions.current.get(JSON.stringify([collection.id, environment?.id]))
    : undefined;
  const totalRequests = workspace.collections.reduce((sum, c) => sum + c.requests.length, 0);
  const backupBlocked = busy || Object.keys(drafts).length > 0;
  const restoreBlocked = useRef(backupBlocked);
  useEffect(() => {
    restoreBlocked.current = backupBlocked;
  }, [backupBlocked]);
  const saving = !storageBlocked && workspace !== persisted && !storageError;
  const hasPendingStorage =
    workspace !== persisted && (!storageBlocked || workspace !== initial.workspace);
  const workspaceSummary = { id: initial.workspaceId, name: workspace.settings.workspaceName };

  function canChangeWorkspace() {
    if (switching) return false;
    if (backupBlocked || hasPendingStorage || importingFiles || updates.progress) {
      toast.error(
        t(
          'Salve ou descarte os rascunhos e aguarde as operações em andamento antes de trocar de workspace.',
        ),
      );
      return false;
    }
    return true;
  }

  function createLocalWorkspace() {
    if (!canChangeWorkspace()) return;
    askName(t('Novo workspace'), t('Dê um nome ao workspace.'), '', (name) => {
      if (canChangeWorkspace()) void changeWorkspace(workspaceSummary, { id: uid(), name }, true);
    });
  }

  useEffect(() => {
    if (storageBlocked) return;
    let superseded = false;
    setStorageError('');
    const { result, cancel } = autosave.enqueue(workspace);
    void result.then(
      (saved) => {
        if (superseded || !saved) return;
        setPersisted(workspace);
        if (restoring.current) {
          restoring.current = false;
          restoreNotice.current = addNotice('restored');
          toast.success(t('Backup restaurado'));
          void showRestoreReport(workspace, true);
        }
        if (saved.cleanupError)
          setStorageError(
            t(
              'O workspace foi salvo, mas a limpeza das credenciais anteriores falhou. {0}',
              normalizeError(saved.cleanupError).message,
            ),
          );
      },
      (error) => {
        if (superseded) return;
        if (restoring.current) {
          addNotice('restoreFailed');
        }
        setStorageError(
          t('Não foi possível salvar o workspace. {0}', normalizeError(error).message),
        );
      },
    );
    return () => {
      superseded = true;
      cancel();
    };
  }, [workspace, storageBlocked, autosave, saveAttempt, addNotice, showRestoreReport]);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setSystemScheme(media.matches ? 'dark' : 'light');
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = palette;
  }, [palette, theme]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(drafts).length || busy || hasPendingStorage || switching)
        event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts, busy, hasPendingStorage, switching]);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const stop = await getCurrentWindow().onCloseRequested((event) => {
          if (switching) {
            event.preventDefault();
            return;
          }
          if (!Object.keys(drafts).length && !busy && !hasPendingStorage) return;
          event.preventDefault();
          setConfirmDialog({
            title: t('Fechar o Fedexe?'),
            description: t(
              'Há alterações pendentes ou uma execução ativa. Salve seu trabalho antes de fechar.',
            ),
            label: t('Fechar sem salvar'),
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
  }, [drafts, busy, hasPendingStorage, switching]);

  const updateCollection = (id: string, update: (c: Collection) => Collection) =>
    setWorkspace((current) => ({
      ...current,
      collections: current.collections.map((c) => (c.id === id ? update(c) : c)),
    }));
  const openRequest = (collectionId: string, requestId: string, bodyShortcut?: string) => {
    setActive({ collectionId, requestId, bodyShortcut });
    setTabs((current) =>
      current.some((t) => t.requestId === requestId)
        ? current
        : [...current, { collectionId, requestId }],
    );
    setView('collections');
  };
  async function locateBackupAttachment(attachment: BackupAttachment) {
    const { collectionId, requestId } = attachment;
    const saved = workspace.collections
      .find(({ id }) => id === collectionId)
      ?.requests.find(({ id }) => id === requestId);
    if (!saved) return;
    setRestoreReport(undefined);
    if (requestLayout === 'response') setRequestLayout('split');
    openRequest(collectionId, requestId, uid());
    if (!native) return;
    try {
      const path = await pickBodyFile();
      if (!path) return;
      setDrafts((current) => {
        const request = current[requestId] ?? saved;
        const updated = replaceBackupAttachment(request, attachment, path);
        if (JSON.stringify(updated) === JSON.stringify(request)) return current;
        return { ...current, [requestId]: updated };
      });
    } catch (error) {
      toast.error(normalizeError(error).message);
    }
  }
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
    const execution = new AbortController();
    manualExecution.current = execution;
    const results: ScriptResult[] = [];
    const attempt = native ? consoleAttemptFactory('editor')(item.id) : undefined;
    const hasPostScript = Boolean(collection.scripts?.after?.trim() || item.scripts?.after?.trim());
    const deferredTrace =
      attempt && hasPostScript ? postResponseTrace(attempt.trace, attempt.script) : undefined;
    const scriptContext = {
      environmentName: environment?.name,
      signal: execution.signal,
      send: sendScriptRequest,
      record: attempt?.script,
    };
    const sessionKey = JSON.stringify([collection.id, environment?.id]);
    const changes = scriptSessions.current.get(sessionKey) ?? new Map<string, string | null>();
    const secrets = [...collection.variables, ...(environment?.variables ?? [])]
      .filter(({ secret }) => secret)
      .map(({ value }) => value);
    const redact = (message: string) => redactValues(message, [...secrets, ...changes.values()]);
    setSendingId(item.id);
    setScriptResults((current) => ({ ...current, [item.id]: [] }));
    setErrors((current) => ({ ...current, [item.id]: false }));
    let status: number | null = null;
    let duration = 0;
    let errorText: string | undefined;
    let prepared = false;
    let skipped = false;
    const start = performance.now();
    try {
      const variables = variablesFor(collection, environment);
      for (const [key, value] of changes) {
        if (value === null) delete variables[key];
        else variables[key] = value;
      }
      const before = await runScripts(
        'before',
        collection,
        item,
        variables,
        changes,
        results,
        redact,
        undefined,
        scriptContext,
      );
      execution.signal.throwIfAborted();
      if (before.failed) throw new Error(t('Falha no script de pré-requisição.'));
      if (before.skipped) {
        skipped = true;
        attempt?.skip();
        toast.info(t('Requisição ignorada pelo script.'));
        return;
      }
      let compiled = compileRequest(before.item, collection, variables, true, false, {
        defaultTimeoutMs,
        defaultRedirectPolicy: native ? defaultRedirectPolicy : undefined,
      });
      if (native) {
        compiled = addConsoleMasks(compiled, before.item, collection, environment, variables);
        for (const value of changes.values()) {
          if (value !== null) compiled.console_masks?.values.push(value);
        }
      }
      prepared = true;
      const response = await send(compiled, deferredTrace?.trace ?? attempt?.trace);
      status = response.status;
      duration = response.duration_ms;
      setResponses((current) => ({ ...current, [item.id]: response }));
      const after = await runScripts(
        'after',
        collection,
        before.item,
        variables,
        changes,
        results,
        redact,
        response,
        {
          ...scriptContext,
          record: deferredTrace?.script ?? attempt?.script,
          protectWrite: deferredTrace?.protect,
        },
      );
      deferredTrace?.finish(!after.failed);
    } catch (error) {
      deferredTrace?.finish(false);
      errorText = redact(normalizeError(error).message);
      duration = Math.round(performance.now() - start);
      attempt?.failure(
        duration,
        execution.signal.aborted
          ? 'cancelled'
          : error instanceof RequestResolutionError
            ? 'resolution'
            : prepared
              ? 'transmission'
              : 'preparation',
      );
      if (execution.signal.aborted) toast.info(errorText);
      else toast.error(errorText);
      setErrors((current) => ({ ...current, [item.id]: true }));
    } finally {
      if (changes.size) scriptSessions.current.set(sessionKey, changes);
      setScriptResults((current) => ({ ...current, [item.id]: results }));
      manualExecution.current = undefined;
      if (!skipped)
        setWorkspace((current) => ({
          ...current,
          history: [
            {
              id: uid(),
              name: item.name,
              method: item.method,
              url: redactUrlCredentials(item.url),
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
  }, [request, collection, environment, busy, defaultTimeoutMs, defaultRedirectPolicy]);

  const cancelExecution = () => {
    manualExecution.current?.abort();
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
          name: t('Minha coleção'),
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
      if (updates.progress || switching) return;
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
  }, [save, sendRequest, addRequest, view, updates.progress, switching]);

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
    askName(t('Nova coleção'), t('Um novo espaço para organizar suas APIs.'), '', (name) => {
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
  function createFolder(c: Collection, parent = '') {
    askName(t('Nova pasta'), t('Organize as requisições de {0}.', c.name), '', (name) => {
      if (name.includes(FOLDER_SEPARATOR)) {
        toast.error(t('O nome da pasta não pode conter “ / ”.'));
        return;
      }
      const path = folderPath(parent, name);
      if (c.folders.some((folder) => isInFolder(folder, path))) {
        toast.error(t('Já existe uma pasta com esse nome.'));
        return;
      }
      updateCollection(c.id, (current) => ({ ...current, folders: [...current.folders, path] }));
      setCollapsed((current) =>
        current.filter((key) => key !== c.id && key !== `${c.id}:${parent}`),
      );
    });
  }
  function toggleCollapsed(key: string) {
    setCollapsed((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  function setTreeMenuOpen(key: string, open: boolean) {
    setTreeMenu((current) => (open ? key : current === key ? undefined : current));
  }
  function setAllFoldersExpanded(expanded: boolean) {
    const folderKeys = workspace.collections.flatMap((c) => c.folders.map((f) => `${c.id}:${f}`));
    if (expanded) {
      const keysToOpen = new Set([
        ...folderKeys,
        ...workspace.collections.filter((c) => c.folders.length > 0).map((c) => c.id),
      ]);
      setCollapsed((current) => current.filter((key) => !keysToOpen.has(key)));
    } else {
      setCollapsed((current) => [...new Set([...current, ...folderKeys])]);
    }
  }

  function relocateFolder(c: Collection, source: string, target: string) {
    if (!canRelocateFolder(c.folders, source, target)) {
      toast.error(t('Já existe uma pasta com esse nome.'));
      return;
    }
    const relocatePath = (path: string) =>
      isInFolder(path, source) ? target + path.slice(source.length) : path;
    const relocateRequest = (request: RequestItem) =>
      isInFolder(request.folder, source)
        ? { ...request, folder: relocatePath(request.folder) }
        : request;
    updateCollection(c.id, (current) => ({
      ...current,
      folders: current.folders.map(relocatePath),
      requests: current.requests.map(relocateRequest),
    }));
    const requestIds = new Set(c.requests.map(({ id }) => id));
    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, request]) => [
          id,
          requestIds.has(id) ? relocateRequest(request) : request,
        ]),
      ),
    );
    const prefix = `${c.id}:`;
    setCollapsed((current) =>
      current.flatMap((key) => {
        if (!key.startsWith(prefix)) return [key];
        const path = relocatePath(key.slice(prefix.length));
        return path !== target && isInFolder(target, path) ? [] : [prefix + path];
      }),
    );
  }
  function duplicateRequest(c: Collection, item: RequestItem) {
    const copy = {
      ...structuredClone(drafts[item.id] || item),
      id: uid(),
      name: t('{0} (cópia)', item.name),
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
        title: t('Descartar alterações?'),
        description: t('Esta requisição tem alterações que ainda não foram salvas.'),
        label: t('Descartar e fechar'),
        action: finish,
      });
    else finish();
  }
  function deleteRequest(c: Collection, item: RequestItem) {
    setConfirmDialog({
      title: t('Excluir requisição?'),
      description: t('“{0}” será removida da coleção {1}.', item.name, c.name),
      label: t('Excluir requisição'),
      action: () => {
        updateCollection(c.id, (current) => ({
          ...current,
          requests: current.requests.filter((r) => r.id !== item.id),
        }));
        removeTabs([item.id]);
        toast.success(t('Requisição excluída'), {
          action: {
            label: t('Desfazer'),
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
      { label: t('Nova requisição'), icon: <Plus size={14} />, action: () => addRequest(c.id) },
      { label: t('Nova pasta'), icon: <FolderPlus size={14} />, action: () => createFolder(c) },
      {
        label: t('Renomear'),
        icon: <Pencil size={14} />,
        action: () =>
          askName(t('Renomear coleção'), t('Encontre o nome ideal para sua API.'), c.name, (name) =>
            updateCollection(c.id, (current) => ({ ...current, name })),
          ),
      },
      {
        label: t('Variáveis, autorização e scripts da coleção'),
        icon: <Braces size={14} />,
        action: () => {
          setCollectionSettingsTab('Variáveis');
          setCollectionScriptsExpanded(false);
          setCollectionSettings(c.id);
        },
      },
      {
        label: t('Duplicar coleção'),
        icon: <Copy size={14} />,
        action: () => {
          const copy = {
            ...structuredClone(c),
            id: uid(),
            name: t('{0} (cópia)', c.name),
            requests: c.requests.map((r) => ({ ...r, id: uid() })),
          };
          setWorkspace((current) => ({ ...current, collections: [...current.collections, copy] }));
        },
      },
      {
        label: t('Exportar JSON'),
        icon: <ArrowDownToLine size={14} />,
        action: () => download(`${c.name}.json`, JSON.stringify(exportableCollection(c), null, 2)),
      },
      {
        label: t('Excluir coleção'),
        icon: <Trash2 size={14} />,
        danger: true,
        action: () =>
          setConfirmDialog({
            title: t('Excluir coleção?'),
            description: t(
              '“{0}” e suas {1} requisições serão removidas.',
              c.name,
              c.requests.length,
            ),
            label: t('Excluir coleção'),
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
          title={t('{0} {1}', current.method, current.url)}
        >
          <MethodBadge method={current.method} small />
          <span>{current.name}</span>
          {drafts[item.id] && <span className="dirty-dot" />}
        </button>
        <Dropdown
          trigger={
            <button className="tree-more" aria-label={t('Ações de {0}', item.name)}>
              <MoreHorizontal size={14} />
            </button>
          }
          items={[
            {
              label: t('Renomear'),
              icon: <Pencil size={14} />,
              action: () =>
                askName(t('Renomear requisição'), '', current.name, (name) => {
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
              label: t('Duplicar'),
              icon: <Copy size={14} />,
              action: () => duplicateRequest(c, item),
            },
            {
              label: t('Mover para pasta'),
              icon: <Folder size={14} />,
              action: () => {
                setMoveTarget(item.folder);
                setMoveRequest({ collectionId: c.id, requestId: item.id });
              },
            },
            {
              label: t('Mover para cima'),
              icon: <ArrowUp size={14} />,
              action: () => reorder(c, item, -1),
            },
            {
              label: t('Mover para baixo'),
              icon: <ArrowDown size={14} />,
              action: () => reorder(c, item, 1),
            },
            {
              label: t('Excluir'),
              icon: <Trash2 size={14} />,
              danger: true,
              action: () => deleteRequest(c, item),
            },
          ]}
        />
      </div>
    );
  }

  function renderCollectionFolders(c: Collection) {
    const folders = indexFolders(c.folders);
    return folders.get('')?.map((folder) => renderFolder(c, folder, '', folders));
  }

  function renderFolder(
    c: Collection,
    folder: string,
    parent: string,
    folders: ReturnType<typeof indexFolders>,
  ) {
    const key = `${c.id}:${folder}`;
    const menuKey = `folder:${key}`;
    const label = parent ? folder.slice(parent.length + FOLDER_SEPARATOR.length) : folder;
    const children = folders.get(folder) ?? [];
    const requests = c.requests.filter((r) => r.folder === folder);
    const branchRequests = c.requests.filter((r) => isInFolder(r.folder, folder));
    const expanded = !!treeSearch || !collapsed.includes(key);
    return (
      <div className="tree-folder-group" key={folder}>
        <div
          className="tree-folder"
          onContextMenu={(event) => {
            event.preventDefault();
            setTreeMenuOpen(menuKey, true);
          }}
        >
          <button
            className="tree-folder-main"
            onClick={() => toggleCollapsed(key)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? <FolderOpen size={15} /> : <FolderClosed size={15} />}
            <span title={label}>{label}</span>
            <span className="tree-count">{formatNumber(branchRequests.length)}</span>
          </button>
          <Dropdown
            open={treeMenu === menuKey}
            onOpenChange={(open) => setTreeMenuOpen(menuKey, open)}
            trigger={
              <button className="tree-more" aria-label={t('Ações da pasta {0}', folder)}>
                <MoreHorizontal size={14} />
              </button>
            }
            items={[
              {
                label: t('Nova requisição'),
                icon: <Plus size={14} />,
                action: () => addRequest(c.id, folder),
              },
              {
                label: t('Nova subpasta'),
                icon: <FolderPlus size={14} />,
                action: () => createFolder(c, folder),
              },
              {
                label: t('Abrir no Runner'),
                icon: <Play size={14} />,
                separatorBefore: true,
                disabled: busy || !branchRequests.length,
                action: () => {
                  setRunnerFolder({
                    collectionId: c.id,
                    folder,
                    environmentId: workspace.activeEnvironment,
                  });
                  setView('runner');
                },
              },
              {
                label: t('Renomear pasta'),
                icon: <Pencil size={14} />,
                separatorBefore: true,
                action: () =>
                  askName(t('Renomear pasta'), '', label, (name) => {
                    if (name === label) return;
                    if (name.includes(FOLDER_SEPARATOR)) {
                      toast.error(t('O nome da pasta não pode conter “ / ”.'));
                      return;
                    }
                    relocateFolder(c, folder, folderPath(parent, name));
                  }),
              },
              {
                label: t('Duplicar pasta'),
                icon: <Copy size={14} />,
                action: () => {
                  let name = t('{0} (cópia)', folder);
                  while (c.folders.some((f) => isInFolder(f, name))) name += t(' (cópia)');
                  const copyPath = (value: string) => name + value.slice(folder.length);
                  updateCollection(c.id, (current) => ({
                    ...current,
                    folders: [
                      ...current.folders,
                      ...current.folders.filter((f) => isInFolder(f, folder)).map(copyPath),
                    ],
                    requests: [
                      ...current.requests,
                      ...branchRequests.map((r) => ({
                        ...structuredClone(r),
                        id: uid(),
                        folder: copyPath(r.folder),
                      })),
                    ],
                  }));
                },
              },
              {
                label: t('Mover pasta…'),
                icon: <Folder size={14} />,
                action: () => {
                  setMoveFolderTarget(undefined);
                  setMoveFolder({ collectionId: c.id, path: folder, label });
                },
              },
              {
                label: t('Expandir tudo nesta pasta'),
                icon: <ChevronsDownUp size={14} />,
                separatorBefore: true,
                disabled: !!treeSearch,
                action: () => {
                  const keys = new Set(
                    c.folders.filter((f) => isInFolder(f, folder)).map((f) => `${c.id}:${f}`),
                  );
                  setCollapsed((current) => current.filter((key) => !keys.has(key)));
                },
              },
              {
                label: t('Recolher tudo nesta pasta'),
                icon: <ChevronsUpDown size={14} />,
                disabled: !!treeSearch,
                action: () => {
                  const keys = c.folders
                    .filter((f) => isInFolder(f, folder))
                    .map((f) => `${c.id}:${f}`);
                  setCollapsed((current) => [...new Set([...current, ...keys])]);
                },
              },
              {
                label: t('Excluir pasta'),
                icon: <Trash2 size={14} />,
                separatorBefore: true,
                danger: true,
                action: () =>
                  setConfirmDialog({
                    title: t('Excluir pasta e requisições?'),
                    description: t(
                      'A pasta “{0}” e suas {1} requisições serão removidas.',
                      folder,
                      branchRequests.length,
                    ),
                    label: t('Excluir pasta'),
                    action: () => {
                      updateCollection(c.id, (current) => ({
                        ...current,
                        folders: current.folders.filter((f) => !isInFolder(f, folder)),
                        requests: current.requests.filter((r) => !isInFolder(r.folder, folder)),
                      }));
                      removeTabs(branchRequests.map((r) => r.id));
                    },
                  }),
              },
            ]}
          />
        </div>
        {expanded && (
          <div className="folder-requests">
            {requests.map((item) => renderRequest(c, item))}
            {children.length > 0 && (
              <div className="tree-subfolders">
                {children.map((child) => renderFolder(c, child, folder, folders))}
              </div>
            )}
            {!requests.length && !children.length && (
              <button className="empty-folder" onClick={() => addRequest(c.id, folder)}>
                <Plus size={12} />
                {' ' + t('Adicionar requisição')}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  function confirmRestore(snapshot: Workspace) {
    setConfirmDialog({
      title: t('Restaurar backup?'),
      description: t(
        'Este backup substituirá as coleções, ambientes e configurações atuais. Exporte seus dados antes de continuar.',
      ),
      label: t('Restaurar backup'),
      action: () => {
        if (restoreBlocked.current) {
          toast.error(
            t('Conclua a execução e salve ou descarte os rascunhos antes de usar o backup.'),
          );
          return;
        }
        restoring.current = true;
        ++restoreInspection.current;
        setRestoreReport(undefined);
        setWorkspace(snapshot);
        setStorageBlocked(false);
        setDrafts({});
        setResponses({});
        setErrors({});
        setScriptResults({});
        scriptSessions.current.clear();
        setLastRun(undefined);
        setTabs([]);
        setActive({ collectionId: snapshot.collections[0]?.id || '', requestId: '' });
        setImportOpen(false);
        setImportText('');
      },
    });
  }

  function noticeAction(notice: Notice) {
    switch (notice.kind) {
      case 'update':
        return () => {
          setView('settings');
          if (updates.version === notice.version) updates.setOpen(true);
        };
      case 'backup':
      case 'backupFailed':
        return driveEnabled ? () => setView('drive') : undefined;
      case 'restored':
        return notice.id === restoreNotice.current
          ? () => void showRestoreReport(workspace, false)
          : () => setView('collections');
      case 'restoreFailed':
      case 'localBackup':
        return () => setView('settings');
      case 'imported':
      case 'importFailed':
        if (importReports[notice.id]) return () => setImportReport(importReports[notice.id]);
        return notice.kind === 'importFailed' ? () => setImportOpen(true) : undefined;
    }
  }

  function importData(text: string) {
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
                  name: t('Importações cURL'),
                  description: '',
                  folders: [],
                  variables: [],
                  auth: emptyAuth(),
                  requests: [request],
                },
              ],
        }));
        openRequest(id, request.id);
        showImportReport({ name: request.name, issues });
        setImportOpen(false);
        setImportText('');
        return;
      }
      const result = importDocument(text);
      if (result.kind === 'openapi') {
        const { collection: imported, environment, issues } = result;
        setWorkspace((current) => ({
          ...current,
          collections: [...current.collections, imported],
          environments: [...current.environments, environment],
          activeEnvironment: environment.id,
        }));
        openRequest(imported.id, imported.requests[0].id);
        showImportReport({ name: imported.name, issues });
        setImportOpen(false);
        setImportText('');
        return;
      }
      if (result.kind === 'backup') {
        confirmRestore(result.workspace);
        return;
      }
      if (result.kind === 'environment') {
        const { environment, issues } = result;
        setWorkspace((current) => ({
          ...current,
          environments: [...current.environments, environment],
        }));
        showImportReport({ name: environment.name, issues });
        setImportOpen(false);
        setImportText('');
        setView('environments');
        return;
      }
      const { collection: c, issues } = result;
      if (issues) showImportReport({ name: c.name, issues });
      else addNotice('imported');
      setWorkspace((current) => ({ ...current, collections: [...current.collections, c] }));
      setImportOpen(false);
      setImportText('');
      if (c.requests[0]) openRequest(c.id, c.requests[0].id);
      else setActive({ collectionId: c.id, requestId: '' });
      toast.success(t('{0}: {1} requisições importadas', c.name, c.requests.length));
    } catch (error) {
      addNotice('importFailed');
      toast.error(normalizeError(error).message);
    }
  }

  async function importFiles(files: File[]) {
    if (!files.length || importingFiles) return;
    setImportingFiles(true);
    try {
      if (files.length === 1) {
        const text = await readImportFile(files[0]);
        setImportText(text);
        importData(text);
        return;
      }

      const result = await importFileBatch(files);
      if (result.succeeded) {
        setWorkspace((current) => ({
          ...current,
          collections: [...current.collections, ...result.collections],
          environments: [...current.environments, ...result.environments],
          activeEnvironment: result.activeEnvironment ?? current.activeEnvironment,
        }));
        const first = result.collections[0];
        if (first?.requests[0]) openRequest(first.id, first.requests[0].id);
        else if (first) {
          setActive({ collectionId: first.id, requestId: '' });
          setView('collections');
        } else setView('environments');
      }
      setImportOpen(false);
      setImportText('');
      showImportReport(
        {
          name: t('{0} de {1} arquivos importados', result.succeeded, files.length),
          entries: result.entries,
          issues: result.issues,
        },
        result.succeeded === 0,
      );
    } catch (error) {
      addNotice('importFailed');
      toast.error(normalizeError(error).message);
    } finally {
      setImportingFiles(false);
    }
  }

  function applyPostmanWorkspace(name: string, result: PostmanImport) {
    const { collections, environments, issues } = result;
    if (collections.length || environments.length) {
      setWorkspace((current) => ({
        ...current,
        collections: [...current.collections, ...collections],
        environments: [...current.environments, ...environments],
      }));
      const first = collections[0];
      if (first) {
        setView('collections');
        if (first.requests[0]) openRequest(first.id, first.requests[0].id);
        else setActive({ collectionId: first.id, requestId: '' });
      } else setView('environments');
    }
    setPostmanOpen(false);
    showImportReport({
      name: t(
        '{0} · {1} coleção(ões) e {2} ambiente(s) importados',
        name,
        collections.length,
        environments.length,
      ),
      issues,
    });
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
        t(
          'A requisição original não está mais na coleção. O histórico preserva apenas seus metadados.',
        ),
      );
  }
  async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
    if (action === 'close' && (Object.keys(drafts).length || busy || hasPendingStorage)) {
      setConfirmDialog({
        title: t('Fechar o Fedexe?'),
        description: t(
          'Há alterações pendentes ou uma execução ativa. Salve seu trabalho antes de fechar.',
        ),
        label: t('Fechar sem salvar'),
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

  const canToggleAllFolders =
    !treeSearch && workspace.collections.some((c) => c.folders.length > 0);
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
      inert={switching}
      className={cn(
        'app-shell',
        workspace.settings.compact && 'compact',
        sidebarHidden && 'sidebar-hidden',
        view !== 'collections' && 'wide-view',
      )}
      style={
        {
          '--collections-width': sidebarWidth === undefined ? undefined : `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <header className="app-header" data-tauri-drag-region="deep">
        <div className="header-brand">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <strong>Fedexe API</strong>
          <span className="version-tag" aria-label={t('Versão {0}', version)}>
            {version}
          </span>
        </div>
        <div className="header-workspace">
          <span className="header-divider" />
          <Dropdown
            trigger={
              <button
                className="inline-icon workspace-selector"
                aria-label={t('Selecionar workspace')}
                title={workspaceSummary.name || t('Meu workspace')}
              >
                <Box size={15} />
                <span>{workspaceSummary.name || t('Meu workspace')}</span>
                <ChevronsUpDown size={12} />
              </button>
            }
            items={[
              ...workspaces.map((entry) => {
                const active = entry.id === workspaceSummary.id;
                const label =
                  (active ? workspaceSummary.name : entry.name) ||
                  (entry.id === originalWorkspaceId
                    ? t('Meu workspace')
                    : t('Workspace {0}', entry.id.slice(0, 8)));
                return {
                  label: active ? t('{0} (ativo)', label) : label,
                  icon: active ? <Check size={14} /> : <Box size={14} />,
                  disabled: active,
                  action: () => {
                    if (canChangeWorkspace()) void changeWorkspace(workspaceSummary, entry);
                  },
                };
              }),
              {
                label: t('Novo workspace'),
                icon: <Plus size={14} />,
                action: createLocalWorkspace,
                separatorBefore: true,
              },
              {
                label: t('Configurar workspace'),
                icon: <Settings2 size={14} />,
                action: () => setView('settings'),
                separatorBefore: true,
              },
              {
                label: t('Exportar backup'),
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
          <span>{t('Encontre qualquer coisa…')}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="header-right">
          <button
            className="header-help"
            aria-label={
              unread ? t('Notificações ({0} não lidas)', formatNumber(unread)) : t('Notificações')
            }
            aria-current={view === 'notifications' ? 'page' : undefined}
            title={t('Notificações')}
            onClick={() => setView('notifications')}
          >
            <Bell size={17} />
            {unread > 0 && <span />}
          </button>
          <button
            className="profile-avatar"
            aria-label={t('Configurações do meu workspace')}
            onClick={() => setView('settings')}
          >
            {t('EU')}
          </button>
        </div>
        {native && (
          <div className="window-controls">
            <button aria-label={t('Minimizar janela')} onClick={() => windowAction('minimize')}>
              <Minus size={15} />
            </button>
            <button
              aria-label={t('Maximizar ou restaurar janela')}
              onClick={() => windowAction('toggleMaximize')}
            >
              <Maximize2 size={12} />
            </button>
            <button
              className="window-close"
              aria-label={t('Fechar janela')}
              onClick={() => windowAction('close')}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </header>
      <nav className="navigation-rail" aria-label={t('Navegação principal')}>
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
            aria-label={t('Configurações')}
            aria-current={view === 'settings' ? 'page' : undefined}
            title={t('Configurações')}
            onClick={() => setView('settings')}
          >
            <Settings2 size={20} strokeWidth={1.7} />
          </button>
          <button
            className="rail-button"
            aria-label={t('Atalhos de teclado')}
            title={t('Atalhos de teclado')}
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard size={20} strokeWidth={1.7} />
          </button>
          <div className="rail-bottom-divider" />
          <button
            className="rail-button help-rail-button"
            aria-label={t('Ajuda e primeiros passos')}
            title={t('Ajuda')}
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp size={19} strokeWidth={1.7} />
          </button>
        </div>
      </nav>
      <aside
        id="collections-sidebar"
        ref={sidebarRef}
        className="collections-sidebar"
        aria-label={t('Árvore de coleções')}
      >
        <div className="sidebar-heading">
          <h2>
            {t('Coleções') + ' '}
            <span>{formatNumber(workspace.collections.length)}</span>
          </h2>
          <div>
            <button
              type="button"
              className="inline-icon"
              aria-label={t('Expandir todas as pastas')}
              title={t('Expandir todas as pastas')}
              disabled={!canToggleAllFolders}
              onClick={() => setAllFoldersExpanded(true)}
            >
              <ChevronsUpDown size={16} />
            </button>
            <button
              type="button"
              className="inline-icon"
              aria-label={t('Recolher todas as pastas')}
              title={t('Recolher todas as pastas')}
              disabled={!canToggleAllFolders}
              onClick={() => setAllFoldersExpanded(false)}
            >
              <ChevronsDownUp size={16} />
            </button>
            <button
              className="inline-icon"
              aria-label={t('Buscar nas coleções')}
              title={t('Buscar nas coleções')}
              onClick={() => setShowTreeSearch((v) => !v)}
            >
              <Search size={16} />
            </button>
            <button
              className="inline-icon"
              aria-label={t('Recolher painel de coleções')}
              title={t('Recolher painel')}
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
                <Plus size={15} />
                {' ' + t('Novo') + ' '}
                <ChevronDown size={12} />
              </Button>
            }
            items={[
              { label: t('Nova requisição'), icon: <Zap size={14} />, action: () => addRequest() },
              { label: t('Nova coleção'), icon: <Layers3 size={14} />, action: createCollection },
              {
                label: t('Nova pasta'),
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
            }}
          >
            <Upload size={13} />
            {' ' + t('Importar')}
          </Button>
        </div>
        {showTreeSearch && (
          <div className="sidebar-search search-field">
            <Search size={14} />
            <input
              autoFocus
              aria-label={t('Filtrar coleções')}
              placeholder={t('Filtrar requisições…')}
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
            />
            <button
              className="inline-icon"
              aria-label={t('Limpar busca')}
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
              <div
                className="tree-collection"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setTreeMenuOpen(`collection:${c.id}`, true);
                }}
              >
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
                  <span className="tree-count">{formatNumber(c.requests.length)}</span>
                </button>
                <Dropdown
                  open={treeMenu === `collection:${c.id}`}
                  onOpenChange={(open) => setTreeMenuOpen(`collection:${c.id}`, open)}
                  trigger={
                    <button className="tree-more" aria-label={t('Ações da coleção {0}', c.name)}>
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
                  {renderCollectionFolders(c)}
                  <button className="add-tree-request" onClick={() => addRequest(c.id)}>
                    <Plus size={13} />
                    {' ' + t('Nova requisição')}
                  </button>
                </div>
              )}
            </div>
          ))}
          {!workspace.collections.length && (
            <div className="sidebar-empty">
              <Layers3 size={28} />
              <p>{t('Sua próxima grande API começa aqui.')}</p>
              <Button variant="secondary" size="sm" onClick={createCollection}>
                {t('Criar coleção')}
              </Button>
            </div>
          )}
        </div>
        <button className="runner-sidebar-link" onClick={() => setView('runner')}>
          <span>
            <Play size={13} fill="currentColor" />
          </span>
          <div>
            <strong>{t('Runner de coleções')}</strong>
            <small>{t('Seu fluxo, de ponta a ponta.')}</small>
          </div>
          <ArrowUpRight size={15} />
        </button>
        <div
          className="collections-resizer"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t('Redimensionar barra lateral')}
          aria-controls="collections-sidebar"
          aria-valuemin={180}
          aria-valuemax={440}
          aria-valuenow={renderedSidebarWidth}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            sidebarDrag.current = { x: event.clientX, width: renderedSidebarWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = sidebarDrag.current;
            if (drag && event.currentTarget.hasPointerCapture(event.pointerId)) {
              resizeSidebar(drag.width + event.clientX - drag.x);
            }
          }}
          onLostPointerCapture={() => {
            sidebarDrag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            resizeSidebar(renderedSidebarWidth + (event.key === 'ArrowLeft' ? -16 : 16));
          }}
        />
      </aside>
      <main className="main-area">
        <div className="main-toolbar" data-tauri-drag-region="deep">
          <div className="breadcrumbs">
            {(sidebarHidden || view !== 'collections') && (
              <button
                className="inline-icon show-sidebar"
                aria-label={t('Mostrar coleções')}
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
                ? t('Coleções')
                : view === 'environments'
                  ? 'Workspace'
                  : view === 'runner' || view === 'console'
                    ? t('Ferramentas')
                    : view === 'history'
                      ? 'Workspace'
                      : t('Preferências')}
            </span>
            <ChevronRight size={12} />
            <span className={!request || view !== 'collections' ? 'breadcrumb-current' : ''}>
              {view === 'collections'
                ? collection?.name || t('Meu workspace')
                : view === 'environments'
                  ? t('Ambientes')
                  : view === 'runner'
                    ? t('Runner de coleções')
                    : view === 'history'
                      ? t('Histórico')
                      : view === 'console'
                        ? t('Console de requisições')
                        : view === 'notifications'
                          ? t('Notificações')
                          : view === 'drive'
                            ? t('Backups no Google Drive')
                            : t('Configurações')}
            </span>
            {view === 'collections' && request?.folder && (
              <>
                <ChevronRight size={12} />
                <span className="breadcrumb-current">{request.folder}</span>
              </>
            )}
          </div>
          <div className="main-toolbar-actions">
            <div className="environment-picker" data-tauri-drag-region="false">
              <Globe2 size={14} />
              <select
                aria-label={t('Ambiente ativo')}
                value={workspace.activeEnvironment}
                disabled={busy}
                onChange={(e) =>
                  setWorkspace((current) => ({ ...current, activeEnvironment: e.target.value }))
                }
              >
                <option value="">{t('Sem ambiente')}</option>
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
              aria-label={t('Gerenciar ambientes')}
              title={t('Gerenciar ambientes')}
              onClick={() => setView('environments')}
            >
              <Settings2 size={15} />
            </button>
          </div>
        </div>
        {storageError && (
          <div className="storage-warning">
            <ShieldCheck size={16} />
            <span>{t('Verifique o armazenamento')}</span>
            {!storageBlocked && (
              <button onClick={() => setSaveAttempt((attempt) => attempt + 1)}>
                {t('Tentar salvar novamente')}
              </button>
            )}
            {(!storageBlocked || initial.recovery) && (
              <button
                onClick={() =>
                  download(
                    'fedexe-recuperacao.json',
                    JSON.stringify(
                      storageBlocked ? initial.recovery : exportableWorkspace(workspace),
                      null,
                      2,
                    ),
                  )
                }
              >
                {t('Exportar dados')}
              </button>
            )}
            {storageBlocked && (
              <button
                onClick={() =>
                  setConfirmDialog({
                    title: t('Iniciar um novo workspace?'),
                    description: initial.recovery
                      ? t(
                          'Exporte os dados de recuperação antes de continuar. O armazenamento local será substituído por este workspace.',
                        )
                      : t('O armazenamento local será substituído por este workspace.'),
                    label: t('Criar novo workspace'),
                    action: () => {
                      setStorageBlocked(false);
                      setStorageError('');
                    },
                  })
                }
              >
                {t('Começar de novo')}
              </button>
            )}
          </div>
        )}
        <div
          className={cn('main-content', view === 'collections' && request && 'with-request-editor')}
        >
          {view === 'collections' ? (
            <>
              <nav className="request-tabbar" aria-label={t('Requisições abertas')}>
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
                          aria-label={t('Fechar aba {0}', item.name)}
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
                  aria-label={t('Nova requisição')}
                  title={t('Nova requisição (Ctrl N)')}
                  onClick={() => addRequest()}
                >
                  <Plus size={17} />
                </button>
                <div className="tabbar-spacer" />
                <button className="tabbar-run" onClick={() => setView('runner')}>
                  <Play size={12} />
                  {' ' + t('Executar coleção')}
                </button>
              </nav>
              {request && collection ? (
                <RequestEditor
                  key={active.bodyShortcut ?? request.id}
                  initialTab={active.bodyShortcut ? 'body' : 'params'}
                  request={request}
                  defaultTimeoutMs={defaultTimeoutMs}
                  defaultRedirectPolicy={defaultRedirectPolicy}
                  collection={collection}
                  environment={environment}
                  sessionVariables={variableSession}
                  onSaveVariable={({ id, source }, value) => {
                    if (source === 'session') {
                      variableSession?.set(id, value);
                      return;
                    }
                    const updateVariable = (row: Pair) => (row.id === id ? { ...row, value } : row);
                    if (source === 'collection') {
                      updateCollection(collection.id, (current) => ({
                        ...current,
                        variables: current.variables.map(updateVariable),
                      }));
                    } else {
                      setWorkspace((current) => ({
                        ...current,
                        environments: current.environments.map((item) =>
                          item.id === environment?.id
                            ? { ...item, variables: item.variables.map(updateVariable) }
                            : item,
                        ),
                      }));
                    }
                  }}
                  onChange={changeDraft}
                  onSave={save}
                  dirty={dirty}
                  busy={busy && sendingId === request.id}
                  onSend={() => {
                    if (busy) toast.info(t('Aguarde a execução atual terminar.'));
                    else void sendRequest();
                  }}
                  onCancel={cancelExecution}
                  response={responses[request.id]}
                  error={errors[request.id]}
                  scriptResults={scriptResults[request.id]}
                  onSnippet={() => setSnippetOpen(true)}
                  wrap={workspace.settings.wrap}
                  layout={requestLayout}
                  onLayoutChange={setRequestLayout}
                  requestShare={requestShare}
                  onRequestShareChange={setRequestShare}
                />
              ) : (
                <div className="welcome-page">
                  <span className="welcome-kicker">
                    <Sparkles size={14} />
                    {' ' + t('MENOS FRICÇÃO. MAIS CRIAÇÃO.')}
                  </span>
                  <div className="welcome-illustration">
                    <div />
                    <Layers3 size={54} strokeWidth={1.2} />
                    <span>
                      <Braces size={22} />
                    </span>
                  </div>
                  <h1>
                    {t('Seu próximo grande projeto')}
                    <br />
                    {t('começa com um request.')}
                  </h1>
                  <p>
                    {t('Um espaço leve para criar, organizar e testar suas APIs.')}
                    <br />
                    {t('No seu ritmo. No seu dispositivo.')}
                  </p>
                  <div className="welcome-actions">
                    <Button onClick={() => addRequest()}>
                      <Plus size={16} />
                      {' ' + t('Nova requisição')}
                    </Button>
                    <Button variant="outline" onClick={() => setImportOpen(true)}>
                      <Upload size={15} />
                      {' ' + t('Importar coleção')}
                    </Button>
                  </div>
                  <div className="welcome-features">
                    <span>
                      <Zap size={15} />
                      {' ' + t('Feito para ser leve')}
                    </span>
                    <span>
                      <Code2 size={15} />
                      {' ' + t('Livre e open source')}
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
          ) : view === 'console' ? (
            <RequestConsole collections={workspace.collections} onOpenRequest={openRequest} />
          ) : view === 'notifications' ? (
            <Notifications items={notices} markRead={markRead} actionFor={noticeAction} />
          ) : view === 'drive' ? null : (
            <SettingsView
              workspace={workspace}
              onChange={setWorkspace}
              onImport={() => setImportOpen(true)}
              onBackup={() => addNotice('localBackup')}
              onDrive={driveEnabled ? () => setView('drive') : undefined}
              updates={<UpdateSettings updates={updates} />}
              version={version}
            />
          )}
          {driveEnabled && (
            <div hidden={view !== 'drive'}>
              <DriveBackups
                active={view === 'drive'}
                workspace={workspace}
                blocked={backupBlocked}
                backupUnavailable={storageBlocked}
                onRestore={confirmRestore}
                onBackup={() => addNotice('backup')}
                onFailure={(operation) =>
                  addNotice(operation === 'backup' ? 'backupFailed' : 'restoreFailed')
                }
              />
            </div>
          )}
          <div hidden={view !== 'runner'}>
            <RunnerView
              workspace={workspace}
              initialFolder={runnerFolder}
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
            <img src="/favicon.svg" width={12} height={12} alt="" /> Fedexe API
          </span>
          {(storageError || saving) && (
            <>
              <span className="statusbar-separator" />
              <span>
                <span className="status-dot dot-amber" />
                {storageError ? t('Verifique o armazenamento') : t('Salvando workspace…')}
              </span>
            </>
          )}
        </div>
        <div>
          {busy ? (
            <span>
              <LoaderCircle size={12} className="spin" />
              {' ' + t('Executando…')}
            </span>
          ) : (
            lastRun && (
              <span>
                <Check size={12} />
                {' ' + t('Última rodada:') + ' '}
                {formatNumber(lastRun.results.length)}
                {' ' + t('etapas')}
              </span>
            )
          )}
          <span>
            {formatNumber(totalRequests)}
            {' ' + t('requisições')}
          </span>
          {!native && (
            <>
              <span className="statusbar-separator" />
              <span>{t('Modo navegador')}</span>
            </>
          )}
        </div>
      </footer>

      <UpdateDialog
        updates={updates}
        blocked={
          Object.keys(drafts).length
            ? t('Salve ou descarte os rascunhos antes de instalar.')
            : busy
              ? t('Aguarde a execução atual terminar antes de instalar.')
              : storageError
                ? t('Resolva o problema de armazenamento antes de instalar.')
                : hasPendingStorage
                  ? t('Aguarde o workspace terminar de salvar.')
                  : ''
        }
      />
      <Dialog
        open={commandOpen}
        onOpenChange={setCommandOpen}
        title={t('Encontre seu próximo passo')}
        description={t('Busque uma requisição ou navegue pelo workspace.')}
        className="command-dialog"
      >
        <div className="command-input">
          <Search size={20} />
          <input
            autoFocus
            aria-label={t('Buscar em todo o workspace')}
            placeholder={t('Digite um nome, endpoint ou comando…')}
            value={commandSearch}
            onChange={(e) => setCommandSearch(e.target.value)}
          />
        </div>
        <div className="command-results">
          <span className="command-group-label">{t('REQUISIÇÕES')}</span>
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
          {!commandResults.length && (
            <p className="small-empty">{t('Nenhuma requisição encontrada.')}</p>
          )}
          <span className="command-group-label">{t('NAVEGAR')}</span>
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
            <kbd>Tab</kbd>
            {' ' + t('para navegar')}
          </span>
          <span>
            <kbd>Enter</kbd>
            {' ' + t('para abrir')}
          </span>
          <span>
            <kbd>Esc</kbd>
            {' ' + t('para fechar')}
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
            {t('Nome')}
            <input
              className="input"
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              maxLength={100}
              placeholder={t('Um nome fácil de encontrar')}
            />
          </label>
          <div className="dialog-footer">
            <Button type="button" variant="outline" onClick={() => setEditDialog(undefined)}>
              {t('Cancelar')}
            </Button>
            <Button type="submit">
              {editDialog?.initial ? t('Salvar nome') : t('Criar')} <ArrowRight size={14} />
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
            {t('Cancelar')}
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
        onOpenChange={(open) => {
          if (!importingFiles) setImportOpen(open);
        }}
        title={t('Traga suas APIs para casa.')}
        description={t('Importe um backup, uma coleção, um ambiente Postman, OpenAPI ou cURL.')}
        className="import-dialog"
      >
        <button
          className="import-dropzone"
          disabled={importingFiles}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void importFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <span>
            <Upload size={25} />
          </span>
          <strong>
            {t(
              importingFiles
                ? 'Importando arquivos…'
                : 'Arraste seus arquivos ou clique para selecionar',
            )}
          </strong>
          <small>{t('Arquivos .json, .yaml e .yml · até 10 MB por arquivo')}</small>
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          multiple
          accept=".json,.yaml,.yml,application/json,application/yaml"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = '';
            void importFiles(files);
          }}
        />
        <div className="import-divider">
          <span />
          {t('ou cole JSON, YAML ou cURL')}
          <span />
        </div>
        <textarea
          aria-label={t('Conteúdo para importar')}
          className="input mono import-textarea"
          value={importText}
          disabled={importingFiles}
          onChange={(e) => {
            setImportText(e.target.value);
          }}
          placeholder={
            '{\n  "variables": { "base_url": "http://localhost:3000" },\n  "requests": []\n}'
          }
          spellCheck={false}
        />
        {native && (
          <Button
            variant="outline"
            disabled={importingFiles}
            onClick={() => {
              setImportOpen(false);
              setPostmanOpen(true);
            }}
          >
            {t('Importar workspace do Postman')}
          </Button>
        )}
        <div className="import-formats">
          <span>
            <FileJson2 size={15} /> Fedexe JSON <Check size={12} />
          </span>
          <span>Postman · OpenAPI · cURL</span>
        </div>
        <div className="dialog-footer">
          <Button variant="outline" disabled={importingFiles} onClick={() => setImportOpen(false)}>
            {t('Cancelar')}
          </Button>
          <Button
            disabled={importingFiles || !importText.trim()}
            onClick={() => importData(importText)}
          >
            {isCurl(importText) ? t('Importar cURL') : t('Importar')} <ArrowRight size={14} />
          </Button>
        </div>
      </Dialog>
      {postmanOpen && (
        <PostmanWorkspaceDialog
          onClose={() => setPostmanOpen(false)}
          onImport={applyPostmanWorkspace}
          onFailure={() => addNotice('importFailed')}
        />
      )}
      <Dialog
        open={!!restoreReport}
        onOpenChange={(open) => {
          if (!open) setRestoreReport(undefined);
        }}
        title={t('Revisar backup restaurado')}
        description={t('Confira os anexos e segredos antes de executar as requisições.')}
      >
        {!!restoreReport?.attachments.length && (
          <section>
            <h3>{t('Anexos a revisar')}</h3>
            <ul className="import-report">
              {restoreReport.attachments.map((attachment) => (
                <li
                  key={JSON.stringify([
                    attachment.collectionId,
                    attachment.requestId,
                    attachment.partId,
                  ])}
                >
                  <strong>{attachment.location}</strong>
                  <div>{attachment.name}</div>
                  <div>
                    {attachment.unchecked
                      ? t('Caminho do arquivo não verificado.')
                      : attachment.path
                        ? t('Arquivo indisponível no caminho salvo.')
                        : t('Nenhum arquivo selecionado')}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void locateBackupAttachment(attachment)}
                  >
                    {native ? t('Abrir requisição e selecionar arquivo') : t('Abrir requisição')}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!!restoreReport?.secrets.length && (
          <section>
            <h3>{t('Segredos a preencher')}</h3>
            <ul className="import-report">
              {restoreReport.secrets.map(({ id, location, name }) => (
                <li key={id}>
                  {location} · {name}
                </li>
              ))}
            </ul>
          </section>
        )}
        {restoreReport && !restoreReport.attachments.length && !restoreReport.secrets.length && (
          <p>{t('Nenhum anexo ou segredo pendente.')}</p>
        )}
        <div className="dialog-footer">
          <Button onClick={() => setRestoreReport(undefined)}>{t('Fechar')}</Button>
        </div>
      </Dialog>
      <Dialog
        open={!!importReport}
        onOpenChange={(open) => {
          if (!open) setImportReport(undefined);
        }}
        title={t('Relatório de importação')}
        description={importReport?.name ?? ''}
      >
        {importReport && (importReport.entries?.length || importReport.issues.length) ? (
          <ul className="import-report">
            {[...(importReport.entries ?? []), ...importReport.issues].map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
        ) : (
          <p>{t('Nenhum ajuste identificado na importação.')}</p>
        )}
        <div className="dialog-footer">
          <Button onClick={() => setImportReport(undefined)}>{t('Concluir')}</Button>
        </div>
      </Dialog>
      <Dialog
        open={snippetOpen}
        onOpenChange={setSnippetOpen}
        title={t('Do seu workspace para o terminal.')}
        description={t(
          'Comando cURL para a requisição atual. Placeholders são preservados; revise os valores antes de compartilhar.',
        )}
        className="snippet-dialog"
      >
        <div className="snippet-language">
          <Terminal size={15} /> Shell · cURL <span className="subtle-badge">bash</span>
        </div>
        <CodeViewer value={snippet} json={false} />
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setSnippetOpen(false)}>
            {t('Fechar')}
          </Button>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(snippet);
                toast.success(t('cURL copiado'));
              } catch {
                toast.error(t('Não foi possível copiar. Selecione o texto manualmente.'));
              }
            }}
          >
            <Copy size={14} />
            {' ' + t('Copiar código')}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        title={t('Seu fluxo, na ponta dos dedos.')}
        description={t('Pequenos atalhos. Grandes diferenças.')}
        className="shortcuts-dialog"
      >
        <div className="shortcut-list">
          {[
            { label: t('Buscar em todo o workspace'), keys: ['Ctrl', 'K'] },
            { label: t('Enviar requisição'), keys: ['Ctrl', 'Enter'] },
            { label: t('Salvar requisição'), keys: ['Ctrl', 'S'] },
            { label: t('Nova requisição'), keys: ['Ctrl', 'N'] },
            { label: t('Alternar painel de coleções'), keys: ['Ctrl', '\\'] },
            { label: t('Fechar diálogo'), keys: ['Esc'] },
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
          <Keyboard size={15} />
          {' ' + t('No macOS, use ⌘ no lugar de Ctrl.')}
        </div>
      </Dialog>
      <Dialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title={t('Olá, mundo. Olá, Fedexe.')}
        description={t(
          'Seu cliente de APIs local, gratuito e feito para manter o foco no que importa.',
        )}
        className="help-dialog"
      >
        <div className="help-hero">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <div>
            <strong>{t('Construir APIs pode ser mais leve.')}</strong>
            <p>{t('Explore a coleção Acme API para conhecer seu novo workspace.')}</p>
          </div>
        </div>
        <div className="help-steps">
          <div>
            <span>01</span>
            <div>
              <h4>{t('Inicie a API de exemplo')}</h4>
              <p>{t('Na pasta do projeto, execute:')}</p>
              <code>node tools/test-server.mjs</code>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <h4>{t('Envie seu primeiro request')}</h4>
              <p>{t('Abra “Listar usuários”, escolha o ambiente Local e clique em Enviar.')}</p>
            </div>
          </div>
          <div>
            <span>03</span>
            <div>
              <h4>{t('Teste o fluxo completo')}</h4>
              <p>
                {t(
                  'O runner obtém um token e o reutiliza nas etapas seguintes. Tudo fica isolado por rodada.',
                )}
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
            <Keyboard size={14} />
            {' ' + t('Ver atalhos')}
          </Button>
          <Button
            onClick={() => {
              setHelpOpen(false);
              setView('collections');
            }}
          >
            {t('Vamos construir') + ' '}
            <ArrowRight size={14} />
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!collectionSettings}
        onOpenChange={(open) => {
          if (!open) setCollectionSettings(undefined);
        }}
        title={t('Configurações da coleção · {0}', settingsCollection?.name || '')}
        description={t('Variáveis, autorização e scripts da coleção')}
        className={cn(
          'collection-settings-dialog',
          collectionSettingsTab === 'Scripts' && collectionScriptsExpanded && 'expanded-scripts',
        )}
      >
        {settingsCollection && (
          <>
            <div
              className="collection-settings-tabs"
              role="tablist"
              aria-label={t('Configurações da coleção')}
              onKeyDown={navigateTabs}
            >
              {collectionSettingsTabs.map((tab, index) => (
                <button
                  id={`collection-settings-tab-${index}`}
                  key={tab}
                  role="tab"
                  aria-selected={collectionSettingsTab === tab}
                  aria-controls={
                    collectionSettingsTab === tab ? 'collection-settings-panel' : undefined
                  }
                  tabIndex={collectionSettingsTab === tab ? 0 : -1}
                  className={cn('tab-button', collectionSettingsTab === tab && 'active')}
                  onClick={() => setCollectionSettingsTab(tab)}
                >
                  {t(tab)}
                </button>
              ))}
            </div>
            <div
              id="collection-settings-panel"
              key={collectionSettingsTab}
              className={cn(
                'collection-settings-panel',
                collectionSettingsTab === 'Variáveis' && 'collection-settings-variables',
                collectionSettingsTab === 'Scripts' && 'collection-settings-scripts',
              )}
              role="tabpanel"
              aria-labelledby={`collection-settings-tab-${collectionSettingsTabs.indexOf(collectionSettingsTab)}`}
            >
              {collectionSettingsTab === 'Variáveis' && (
                <PairEditor
                  searchable
                  kind={t('variável')}
                  rows={settingsCollection.variables}
                  onChange={(variables) =>
                    updateCollection(settingsCollection.id, (current) => ({
                      ...current,
                      variables,
                    }))
                  }
                />
              )}
              {collectionSettingsTab === 'Autorização' && (
                <div className="collection-auth-settings auth-fields">
                  <AuthType auth={settingsCollection.auth} onChange={updateCollectionAuth} />
                  <AuthFields auth={settingsCollection.auth} onChange={updateCollectionAuth} />
                </div>
              )}
              {collectionSettingsTab === 'Scripts' && (
                <Suspense fallback={<p role="status">{t('Carregando editor…')}</p>}>
                  <ScriptEditor
                    scripts={settingsCollection.scripts}
                    expanded={collectionScriptsExpanded}
                    onToggleExpanded={() => setCollectionScriptsExpanded((expanded) => !expanded)}
                    onChange={(scripts) =>
                      updateCollection(settingsCollection.id, (current) => ({
                        ...current,
                        scripts,
                      }))
                    }
                  />
                </Suspense>
              )}
            </div>
            <div className="dialog-footer">
              <span className="muted">{t('Alterações salvas automaticamente')}</span>
              <Button onClick={() => setCollectionSettings(undefined)}>
                {t('Concluir') + ' '}
                <Check size={14} />
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
        title={t('Cada request no seu lugar.')}
        description={t('Escolha a pasta de destino dentro da coleção.')}
      >
        <label className="field-label">
          {t('Pasta')}
          <select
            className="input"
            value={moveTarget}
            onChange={(e) => setMoveTarget(e.target.value)}
          >
            <option value="">{t('Raiz da coleção')}</option>
            {workspace.collections
              .find((c) => c.id === moveRequest?.collectionId)
              ?.folders.map((f) => (
                <option key={f}>{f}</option>
              ))}
          </select>
        </label>
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setMoveRequest(undefined)}>
            {t('Cancelar')}
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
            {t('Mover requisição') + ' '}
            <ArrowRight size={14} />
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={!!moveFolder}
        onOpenChange={(open) => {
          if (!open) setMoveFolder(undefined);
        }}
        title={t('Mover pasta…')}
        description={t('Escolha a pasta de destino dentro da coleção.')}
      >
        {moveFolderDestinations.length ? (
          <label className="field-label">
            {t('Pasta')}
            <select
              className="input"
              value={moveFolderDestination}
              onChange={(event) => setMoveFolderTarget(event.target.value)}
            >
              {moveFolderDestinations.map((path) => (
                <option key={path} value={path}>
                  {path || t('Raiz da coleção')}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>{t('Não há outro destino disponível para esta pasta.')}</p>
        )}
        <div className="dialog-footer">
          <Button variant="outline" onClick={() => setMoveFolder(undefined)}>
            {t('Cancelar')}
          </Button>
          <Button
            disabled={moveFolderDestination === undefined}
            onClick={() => {
              if (!moveFolder || !moveFolderCollection || moveFolderDestination === undefined)
                return;
              relocateFolder(
                moveFolderCollection,
                moveFolder.path,
                folderPath(moveFolderDestination, moveFolder.label),
              );
              setMoveFolder(undefined);
            }}
          >
            {t('Mover pasta') + ' '}
            <ArrowRight size={14} />
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

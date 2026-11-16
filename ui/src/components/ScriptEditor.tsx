import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { closeSearchPanel, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { EditorState, Transaction } from '@codemirror/state';
import { classHighlighter } from '@lezer/highlight';
import { basicSetup, EditorView } from 'codemirror';
import { Maximize2, Minimize2, Search } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { formatNumber, t, useLocale } from '../lib/i18n';
import { navigateTabs } from '../lib/keyboard';
import type { Scripts } from '../lib/scripts';

const phases = [
  ['before', 'Pré-requisição'],
  ['after', 'Pós-resposta'],
] as const;

const syntaxCheck = linter(({ state }) => {
  const diagnostics: Diagnostic[] = [];
  javascriptLanguage.parser.parse(state.doc.toString()).iterate({
    enter: ({ type, from, to }) => {
      if (type.isError) {
        diagnostics.push({
          from,
          to,
          severity: 'error',
          message: t('Erro de sintaxe na linha {0}.', formatNumber(state.doc.lineAt(from).number)),
        });
      }
    },
  });
  return diagnostics;
});

function ScriptPhase({
  source,
  onChange,
  label,
  id,
  active,
  editor,
}: {
  source: string;
  onChange: (source: string) => void;
  label: string;
  id: string;
  active: boolean;
  editor: RefObject<EditorView | null>;
}) {
  const locale = useLocale();
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ source, onChange });
  useLayoutEffect(() => {
    latest.current = { source, onChange };
    const view = editor.current;
    if (view && !view.state.toText(source).eq(view.state.doc)) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        annotations: Transaction.addToHistory.of(false),
      });
    }
  }, [source, onChange, editor]);

  useLayoutEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      doc: latest.current.source,
      parent: host.current,
      extensions: [
        basicSetup,
        javascript(),
        syntaxHighlighting(classHighlighter),
        syntaxCheck,
        lintGutter(),
        EditorState.phrases.of({
          Find: t('Buscar no script'),
          Replace: t('Substituir'),
          next: t('Próxima ocorrência'),
          previous: t('Ocorrência anterior'),
          all: t('Todas'),
          'match case': t('Diferenciar maiúsculas'),
          regexp: t('Expressão regular'),
          'by word': t('Palavra inteira'),
          replace: t('Substituir'),
          'replace all': t('Substituir tudo'),
          close: t('Fechar'),
          Diagnostics: t('Diagnósticos'),
          'No diagnostics': t('Sem diagnósticos'),
          'Go to line': t('Ir para a linha'),
          go: t('Ir'),
          'current match': t('Ocorrência atual'),
          'on line': t('na linha'),
          'replaced match on line $': t('Ocorrência substituída na linha $'),
          'replaced $ matches': t('$ ocorrências substituídas'),
        }),
        EditorView.contentAttributes.of({
          'aria-label': label,
          spellcheck: 'false',
          autocapitalize: 'off',
          autocomplete: 'off',
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const value = update.state.doc.toString();
          if (!update.state.doc.eq(update.state.toText(latest.current.source)))
            latest.current.onChange(value);
        }),
      ],
    });
    editor.current = view;
    function closeSearchOnEscape(event: KeyboardEvent) {
      if (
        event.key === 'Escape' &&
        event.target instanceof Node &&
        view.dom.contains(event.target) &&
        searchPanelOpen(view.state)
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeSearchPanel(view);
      }
    }
    // Handle the search panel before a containing dialog consumes Escape.
    window.addEventListener('keydown', closeSearchOnEscape, true);
    return () => {
      window.removeEventListener('keydown', closeSearchOnEscape, true);
      view.destroy();
      editor.current = null;
    };
  }, [label, locale, editor]);

  return (
    <div
      id={`${id}-panel`}
      className="script-phase-panel"
      role="tabpanel"
      aria-labelledby={`${id}-tab`}
      hidden={!active}
    >
      <div className="script-code" ref={host} />
    </div>
  );
}

export default function ScriptEditor({
  scripts,
  onChange,
  expanded,
  onToggleExpanded,
}: {
  scripts?: Scripts;
  onChange: (scripts: Scripts) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
}) {
  const [phase, setPhase] = useState<keyof Scripts>('before');
  const beforeEditor = useRef<EditorView>(null);
  const afterEditor = useRef<EditorView>(null);
  const editors = { before: beforeEditor, after: afterEditor };
  const id = useId();
  const expandLabel = t(expanded ? 'Reduzir editor' : 'Expandir editor');

  return (
    <div className="script-editor">
      <p className="field-hint">
        {t('Os scripts da coleção rodam antes dos scripts da requisição em cada fase.')}
      </p>
      <div className="script-editor-toolbar">
        <div role="tablist" aria-label={t('Etapas do script')} onKeyDown={navigateTabs}>
          {phases.map(([key, label]) => (
            <button
              key={key}
              type="button"
              id={`${id}-${key}-tab`}
              role="tab"
              aria-selected={phase === key}
              aria-controls={`${id}-${key}-panel`}
              tabIndex={phase === key ? 0 : -1}
              className={`tab-button${phase === key ? ' active' : ''}`}
              onClick={() => setPhase(key)}
            >
              {t(label)}
              {scripts?.[key]?.trim() && (
                <span className="tiny-dot" role="img" aria-label={t('Script configurado')} />
              )}
            </button>
          ))}
        </div>
        <div className="script-editor-actions">
          <button
            type="button"
            className="inline-icon"
            aria-label={t('Buscar no script')}
            title={t('Buscar no script')}
            onClick={() => {
              const editor = editors[phase].current;
              if (editor) openSearchPanel(editor);
            }}
          >
            <Search size={15} />
          </button>
          {onToggleExpanded && (
            <button
              type="button"
              className="inline-icon"
              aria-label={expandLabel}
              title={expandLabel}
              aria-pressed={expanded}
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
        </div>
      </div>
      {phases.map(([key, label]) => (
        <ScriptPhase
          key={key}
          id={`${id}-${key}`}
          source={scripts?.[key] ?? ''}
          label={t(label)}
          active={phase === key}
          editor={editors[key]}
          onChange={(value) => onChange({ ...scripts, [key]: value })}
        />
      ))}
    </div>
  );
}

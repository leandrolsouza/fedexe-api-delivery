import { refreshVariableOrigins, variableOriginDecorations } from './variable-origin-decorations';
import { VariableSourceIcon, type EditableVariable } from './VariableUrlInput';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting } from '@codemirror/language';
import { Transaction } from '@codemirror/state';
import { classHighlighter } from '@lezer/highlight';
import { basicSetup, EditorView } from 'codemirror';
import { Braces, FileJson2 } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { toast } from 'sonner';
import { t } from '../lib/i18n';
import { rawBodyFormats, type RawBodyFormat, type RequestItem } from '../lib/models';
import { FileBodyEditor } from './FileBodyEditor';
import { PairEditor } from './PairEditor';

function BodyCode({
  label,
  source,
  onChange,
  format,
  resolveVariable,
}: {
  label: string;
  source: string;
  onChange: (source: string) => void;
  format?: RawBodyFormat;
  resolveVariable?: (name: string) => EditableVariable | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const latest = useRef({ source, onChange, resolveVariable });
  const icons = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    latest.current = { source, onChange, resolveVariable };
    const view = editor.current;
    if (view && !view.state.doc.eq(view.state.toText(source))) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        annotations: Transaction.addToHistory.of(false),
      });
    }
    view?.dispatch({ effects: refreshVariableOrigins.of(null) });
  }, [source, onChange, resolveVariable]);

  const highlight = format === 'javascript' || format === 'json';
  useLayoutEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      doc: latest.current.source,
      parent: host.current,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        variableOriginDecorations(
          (name) => latest.current.resolveVariable?.(name),
          (source) =>
            icons.current?.querySelector('[data-source="' + (source ?? 'missing') + '"] svg') ??
            undefined,
        ),
        ...(highlight ? [javascript(), syntaxHighlighting(classHighlighter)] : []),
        EditorView.contentAttributes.of({
          'aria-label': label,
          'aria-multiline': 'true',
          spellcheck: 'false',
          autocapitalize: 'off',
        }),
        EditorView.updateListener.of(({ docChanged, state }) => {
          if (docChanged && !state.doc.eq(state.toText(latest.current.source)))
            latest.current.onChange(state.doc.toString());
        }),
      ],
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [highlight, label]);

  return (
    <>
      <div ref={icons} hidden>
        {(['collection', 'environment', 'session', undefined] as const).map((source) => (
          <span key={source ?? 'missing'} data-source={source ?? 'missing'}>
            <VariableSourceIcon source={source} />
          </span>
        ))}
      </div>
      <div className="body-code" ref={host} />
    </>
  );
}

const modes = [
  ['none', 'Nenhum'],
  ['multipart', 'form-data'],
  ['urlencoded', 'x-www-form-urlencoded'],
  ['raw', 'raw'],
  ['binary', 'Binário'],
  ['graphql', 'GraphQL'],
] as const;

export default function RequestBody({
  request,
  onChange,
  resolveVariable,
}: {
  request: RequestItem;
  onChange: (patch: Partial<RequestItem>) => void;
  resolveVariable?: (name: string) => EditableVariable | undefined;
}) {
  const { bodyType, body, rawFormat } = request;
  const mode = bodyType === 'json' || bodyType === 'text' ? 'raw' : bodyType;
  const format = bodyType === 'json' ? 'json' : (rawFormat ?? 'text');
  const graphql = request.graphql ?? { query: '', variables: '' };
  const labels = {
    text: t('Texto'),
    javascript: 'JavaScript',
    json: 'JSON',
    html: 'HTML',
    xml: 'XML',
  };
  const selectFormat = (format: RawBodyFormat) =>
    onChange({ bodyType: format === 'json' ? 'json' : 'text', rawFormat: format });
  const canFormat = (mode === 'raw' && format === 'json') || mode === 'graphql';

  function beautify() {
    try {
      if (mode === 'graphql' && !graphql.variables.trim()) return;
      const formatted = JSON.stringify(
        JSON.parse(mode === 'graphql' ? graphql.variables : body),
        null,
        2,
      );
      if (mode === 'graphql') onChange({ graphql: { ...graphql, variables: formatted } });
      else onChange({ body: formatted });
    } catch {
      toast.error(t('JSON inválido. Verifique a sintaxe do corpo.'));
    }
  }

  return (
    <>
      <div className="body-options" role="group" aria-label={t('Modo do corpo')}>
        {modes.map(([id, label]) => (
          <label key={id}>
            <input
              type="radio"
              name="body-type"
              checked={mode === id}
              onChange={() =>
                id === 'raw'
                  ? selectFormat(format)
                  : onChange({ bodyType: id, rawFormat: bodyType === 'json' ? 'json' : rawFormat })
              }
            />
            {label === 'Nenhum' || label === 'Binário' ? t(label) : label}
          </label>
        ))}
        {mode === 'raw' && (
          <select
            className="body-format"
            aria-label={t('Formato do corpo')}
            value={format}
            onChange={(event) => {
              const selected = rawBodyFormats.find(
                (format) => format === event.currentTarget.value,
              );
              if (selected) selectFormat(selected);
            }}
          >
            {rawBodyFormats.map((format) => (
              <option key={format} value={format}>
                {labels[format]}
              </option>
            ))}
          </select>
        )}
        {canFormat && (
          <button className="body-beautify" type="button" onClick={beautify}>
            <Braces size={13} />
            {t('Formatar')}
          </button>
        )}
      </div>
      {mode === 'none' && (
        <div className="body-empty">
          <FileJson2 size={28} />
          <p>{t('Esta requisição não tem corpo.')}</p>
        </div>
      )}
      {mode === 'urlencoded' && (
        <PairEditor
          resolveVariable={resolveVariable}
          kind={t('campo')}
          rows={request.form}
          onChange={(form) => onChange({ form })}
        />
      )}
      {(mode === 'multipart' || mode === 'binary') && (
        <FileBodyEditor request={request} onChange={onChange} resolveVariable={resolveVariable} />
      )}
      {mode === 'raw' && (
        <BodyCode
          resolveVariable={resolveVariable}
          label={t('Corpo da requisição')}
          source={body}
          format={format}
          onChange={(body) => onChange({ body })}
        />
      )}
      {mode === 'graphql' && (
        <div className="graphql-body">
          <div>
            <span>{t('Consulta GraphQL')}</span>
            <BodyCode
              resolveVariable={resolveVariable}
              label={t('Consulta GraphQL')}
              source={graphql.query}
              onChange={(query) => onChange({ graphql: { ...graphql, query } })}
            />
          </div>
          <div>
            <span>{t('Variáveis GraphQL')}</span>
            <BodyCode
              resolveVariable={resolveVariable}
              label={t('Variáveis GraphQL')}
              source={graphql.variables}
              format="json"
              onChange={(variables) => onChange({ graphql: { ...graphql, variables } })}
            />
          </div>
        </div>
      )}
    </>
  );
}

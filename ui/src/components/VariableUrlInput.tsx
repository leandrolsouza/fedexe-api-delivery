import { useRef, useState, type InputHTMLAttributes } from 'react';
import { Braces, CircleHelp, Eye, EyeOff, Globe2, Layers3, Pencil, Trash2 } from 'lucide-react';
import { t } from '../lib/i18n';
import { Button } from './ui/button';

export type EditableVariable = {
  id: string;
  source: 'collection' | 'environment' | 'session';
  value: string;
  secret?: boolean;
  sourceName?: string;
};

export function variableSourceLabel(source?: EditableVariable['source']) {
  return t(
    source === 'collection'
      ? 'Coleção'
      : source === 'environment'
        ? 'Ambiente'
        : source === 'session'
          ? 'Sessão de scripts'
          : 'Ausente',
  );
}

export function variableOriginLabel(variable?: EditableVariable) {
  const kind = variableSourceLabel(variable?.source);
  return variable?.sourceName ? kind + ': ' + variable.sourceName : kind;
}

export function VariableSourceIcon({ source }: { source?: EditableVariable['source'] }) {
  const Icon =
    source === 'collection'
      ? Layers3
      : source === 'environment'
        ? Globe2
        : source === 'session'
          ? Braces
          : CircleHelp;
  return <Icon size={14} aria-hidden="true" />;
}

export function VariableOriginBadge({
  name,
  variable,
  offset,
}: {
  name: string;
  variable?: EditableVariable;
  offset?: number;
}) {
  const props = {
    className: 'url-variable-origin',
    'data-variable-origin-icon': 'true',
    'data-variable-reference': name,
    'data-variable-offset': offset,
    title: variableOriginLabel(variable),
  };
  const icon = <VariableSourceIcon source={variable?.source} />;
  return variable && ['collection', 'environment'].includes(variable.source) ? (
    <button {...props} type="button" aria-label={name + ' · ' + variableOriginLabel(variable)}>
      {icon}
    </button>
  ) : (
    <span {...props} aria-hidden="true">
      {icon}
    </span>
  );
}

export type VariableTarget = { source: 'collection' | 'environment'; id: string; label: string };
export type VariableCreation = {
  creationTargets?: VariableTarget[];
  onCreateVariable?: (name: string, value: string, target: VariableTarget, secret: boolean) => void;
};

export function VariableUrlInput({
  value,
  resolveVariable,
  sourceLabel,
  onSaveVariable,
  onDeleteVariable,
  onRenameVariable,
  creationTargets,
  onCreateVariable,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value'> &
  VariableCreation & {
    value: string;
    resolveVariable: (name: string) => EditableVariable | undefined;
    sourceLabel: (source: EditableVariable['source']) => string;
    onSaveVariable: (variable: EditableVariable, value: string, secret: boolean) => void;
    onDeleteVariable?: (variable: EditableVariable, name: string) => void;
    onRenameVariable?: (variable: EditableVariable, name: string) => void;
  }) {
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const mirrorText = useRef<HTMLSpanElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ index: number; left: number; keyboard: boolean }>();
  const matches = [...value.matchAll(/\{\{([^{}]+)\}\}/g)];
  const match = matches.find(({ index }) => index === active?.index);
  const name = match?.[1].trim();
  const variable = name ? resolveVariable(name) : undefined;
  const sourceSummary = matches
    .map((token) => `${token[1].trim()}: ${variableOriginLabel(resolveVariable(token[1].trim()))}`)
    .join('; ');

  function syncScroll() {
    if (input.current && mirrorText.current) {
      mirrorText.current.style.left = `${-input.current.scrollLeft}px`;
    }
  }

  function open(index: number, element: HTMLElement, keyboard: boolean) {
    const bounds = mirror.current?.getBoundingClientRect();
    if (!bounds) return;
    const left = element.getBoundingClientRect().left - bounds.left;
    setActive({ index, left, keyboard });
  }

  function close(restoreFocus: boolean) {
    setActive(undefined);
    if (restoreFocus) input.current?.focus();
  }

  let end = 0;
  const decoratedValue = matches.map((token) => {
    const before = value.slice(end, token.index);
    end = token.index + token[0].length;
    const tokenVariable = resolveVariable(token[1].trim());
    return (
      <span key={token.index}>
        <span aria-hidden="true">{before}</span>
        <span
          className="url-variable-token"
          data-variable-index={token.index}
          data-variable-source={resolveVariable(token[1].trim())?.source ?? 'missing'}
        >
          <VariableOriginBadge
            name={token[1].trim()}
            variable={tokenVariable}
            offset={token.index}
          />
          <span aria-hidden="true">{token[0]}</span>
        </span>
      </span>
    );
  });

  return (
    <div
      className="variable-url"
      onMouseMove={(event) => {
        if (popover.current?.contains(document.activeElement) || event.buttons) return;
        const target = event.target;
        if (target instanceof Element && target.closest('[data-variable-origin-icon]')) {
          close(false);
          return;
        }
        if (target !== input.current) return;
        syncScroll();
        const token = Array.from(
          mirror.current?.querySelectorAll<HTMLElement>('[data-variable-index]') ?? [],
        ).find((element) => {
          const rect = element.getBoundingClientRect();
          return event.clientX >= rect.left && event.clientX < rect.right;
        });
        if (token) {
          const index = Number(token.dataset.variableIndex);
          if (index !== active?.index) open(index, token, false);
        }
      }}
      onMouseLeave={() => {
        if (!popover.current?.contains(document.activeElement)) close(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && active) {
          event.preventDefault();
          close(popover.current?.contains(document.activeElement) ?? false);
        }
      }}
    >
      <div className="url-input url-variable-mirror" ref={mirror}>
        <span ref={mirrorText}>
          {decoratedValue}
          <span aria-hidden="true">{value.slice(end)}</span>
        </span>
      </div>
      <input
        {...inputProps}
        ref={input}
        className="url-input"
        value={value}
        onScroll={syncScroll}
        onChange={(event) => {
          close(false);
          inputProps.onChange?.(event);
          syncScroll();
        }}
        onKeyDown={(event) => {
          if (!event.altKey || event.key !== 'ArrowDown') return;
          const caret = event.currentTarget.selectionStart ?? 0;
          const token = matches.find(
            ({ index, 0: text }) => caret >= index && caret <= index + text.length,
          );
          if (!token) return;
          const element = mirror.current?.querySelector<HTMLElement>(
            `[data-variable-index="${token.index}"]`,
          );
          if (!element) return;
          event.preventDefault();
          open(token.index, element, true);
        }}
        aria-keyshortcuts="Alt+ArrowDown"
        title={inputProps.title ?? sourceSummary}
        aria-description={sourceSummary || undefined}
      />
      {active && name && (
        <div
          className="url-variable-popover"
          ref={popover}
          style={{
            left: `clamp(0px, ${active.left}px, calc(100% - var(--variable-popover-width)))`,
          }}
        >
          <VariableValue
            key={JSON.stringify([active.index, active.keyboard, variable?.source, variable?.id])}
            name={name}
            creationTargets={creationTargets}
            onCreateVariable={
              onCreateVariable
                ? (name, value, target, secret) => {
                    onCreateVariable(name, value, target, secret);
                    close(true);
                  }
                : undefined
            }
            variable={variable}
            onDelete={
              variable && onDeleteVariable
                ? () => {
                    onDeleteVariable(variable, name);
                    close(true);
                  }
                : undefined
            }
            onRename={
              variable && onRenameVariable
                ? () => {
                    onRenameVariable(variable, name);
                    close(true);
                  }
                : undefined
            }
            label={variable ? sourceLabel(variable.source) : t('Ausente')}
            autoFocus={active.keyboard}
            onSave={(value, secret) => {
              if (variable) onSaveVariable(variable, value, secret);
              close(true);
            }}
          />
        </div>
      )}
    </div>
  );
}

export function VariableValue({
  name,
  variable,
  label,
  autoFocus,
  onSave,
  onDelete,
  onRename,
  creationTargets = [],
  onCreateVariable,
}: VariableCreation & {
  name: string;
  variable?: EditableVariable;
  label: string;
  autoFocus: boolean;
  onSave: (value: string, secret: boolean) => void;
  onDelete?: () => void;
  onRename?: () => void;
}) {
  const [value, setValue] = useState(variable?.value ?? '');
  const [visible, setVisible] = useState(false);
  const [targetKey, setTargetKey] = useState('');
  const [secret, setSecret] = useState(variable?.secret ?? false);
  const isSecret = secret;
  const dirty = !!variable && (value !== variable.value || secret !== !!variable.secret);
  const target =
    creationTargets.find((item) => `${item.source}:${item.id}` === targetKey) ?? creationTargets[0];
  const canCreate = !variable && !!name.trim() && !!target && !!onCreateVariable;
  const submit = () => {
    if (variable) {
      if (dirty) onSave(value, secret);
    } else if (canCreate) onCreateVariable(name, value, target, secret);
  };

  return (
    <>
      <code>{`{{${name}}}`}</code>
      {canCreate && (
        <label className="variable-create-target">
          <span className="variable-source-label">
            <VariableSourceIcon source={target?.source} />
            {t('Criar em')}
          </span>
          <select
            value={target ? `${target.source}:${target.id}` : ''}
            onChange={(event) => setTargetKey(event.target.value)}
          >
            {creationTargets.map((item) => (
              <option key={`${item.source}:${item.id}`} value={`${item.source}:${item.id}`}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {(variable || canCreate) && (
        <div className="url-variable-value">
          <input
            aria-label={t('Valor de {0}', name)}
            type={isSecret && !visible ? 'password' : 'text'}
            placeholder={isSecret ? t('Segredo') : t('Valor')}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              submit();
            }}
            spellCheck={false}
            autoComplete="off"
            autoFocus={autoFocus}
          />
          {isSecret && (
            <button
              className="inline-icon"
              type="button"
              aria-label={t(visible ? 'Ocultar valor' : 'Mostrar valor')}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          )}
        </div>
      )}
      {(canCreate || (variable && variable.source !== 'session')) && (
        <label className="variable-create-secret">
          <input
            type="checkbox"
            checked={secret}
            onChange={(event) => {
              setSecret(event.target.checked);
              setVisible(false);
            }}
          />
          {t('Marcar como segredo')}
        </label>
      )}
      <div className="url-variable-footer">
        <span
          className="variable-source-label"
          title={t(
            variable?.source === 'collection'
              ? 'Coleção'
              : variable?.source === 'environment'
                ? 'Ambiente'
                : variable?.source === 'session'
                  ? 'Sessão de scripts'
                  : 'Ausente',
          )}
        >
          <VariableSourceIcon source={variable?.source} />
          {label}
        </span>
        {(variable || canCreate) && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!!variable && !dirty}
            onClick={submit}
          >
            {t(variable ? 'Salvar' : 'Criar variável')}
          </Button>
        )}
      </div>
      {variable && onRename && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="variable-rename-button"
          onClick={onRename}
        >
          <Pencil size={13} aria-hidden="true" /> {t('Renomear variável')}
        </Button>
      )}
      {variable && onDelete && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="variable-delete-button"
          onClick={onDelete}
        >
          <Trash2 size={13} aria-hidden="true" /> {t('Excluir variável')}
        </Button>
      )}
    </>
  );
}

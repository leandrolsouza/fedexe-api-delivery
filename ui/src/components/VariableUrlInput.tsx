import { useRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { t } from '../lib/i18n';
import { Button } from './ui/button';

export type EditableVariable = {
  id: string;
  source: 'collection' | 'environment' | 'session';
  value: string;
  secret?: boolean;
};

export function VariableUrlInput({
  value,
  resolveVariable,
  sourceLabel,
  onSaveVariable,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value'> & {
  value: string;
  resolveVariable: (name: string) => EditableVariable | undefined;
  sourceLabel: (source: EditableVariable['source']) => string;
  onSaveVariable: (variable: EditableVariable, value: string) => void;
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

  function syncScroll() {
    if (input.current && mirrorText.current) {
      mirrorText.current.style.transform = `translateX(${-input.current.scrollLeft}px)`;
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
    return (
      <span key={token.index}>
        {before}
        <span className="url-variable-token" data-variable-index={token.index}>
          {token[0]}
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
      <div className="url-input url-variable-mirror" ref={mirror} aria-hidden="true">
        <span ref={mirrorText}>
          {decoratedValue}
          {value.slice(end)}
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
            variable={variable}
            label={variable ? sourceLabel(variable.source) : t('Ausente')}
            autoFocus={active.keyboard}
            onSave={(value) => {
              if (variable) onSaveVariable(variable, value);
              close(true);
            }}
          />
        </div>
      )}
    </div>
  );
}

function VariableValue({
  name,
  variable,
  label,
  autoFocus,
  onSave,
}: {
  name: string;
  variable?: EditableVariable;
  label: string;
  autoFocus: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(variable?.value ?? '');
  const [visible, setVisible] = useState(false);

  return (
    <>
      <code>{`{{${name}}}`}</code>
      {variable && (
        <div className="url-variable-value">
          <input
            aria-label={t('Valor de {0}', name)}
            type={variable.secret && !visible ? 'password' : 'text'}
            placeholder={variable.secret ? t('Segredo') : t('Valor')}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (value !== variable.value) onSave(value);
            }}
            spellCheck={false}
            autoComplete="off"
            autoFocus={autoFocus}
          />
          {variable.secret && (
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
      <div className="url-variable-footer">
        <span>{label}</span>
        {variable && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={value === variable.value}
            onClick={() => onSave(value)}
          >
            {t('Salvar')}
          </Button>
        )}
      </div>
    </>
  );
}

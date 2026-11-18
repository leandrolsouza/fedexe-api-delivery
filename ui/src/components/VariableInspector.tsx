import {
  captureVariableReference,
  type VariableReferenceLocation,
} from '../lib/variable-reference-location';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView } from 'codemirror';
import { t } from '../lib/i18n';
import {
  VariableValue,
  type EditableVariable,
  type VariableTarget,
  type VariableCreation,
} from './VariableUrlInput';

export type ScopedVariable = EditableVariable & {
  collectionId?: string;
  environmentId?: string;
  label: string;
};
type Reference = { name: string; owner: HTMLElement; left: number; top: number; keyboard: boolean };

function tokenAt(text: string, position: number) {
  return [...text.matchAll(/\{\{([^{}]+)\}\}/g)]
    .find((token) => position >= token.index && position < token.index + token[0].length)?.[1]
    .trim();
}

// Native text fields have no DOM ranges. A temporary mirror measures wrapped and scrolled tokens.
function fieldReference(field: HTMLInputElement | HTMLTextAreaElement, x: number, y: number) {
  if (
    field instanceof HTMLInputElement &&
    !['text', 'search', 'url', 'password', 'email', ''].includes(field.type)
  )
    return;
  if (!field.value.includes('{{')) return;
  const rect = field.getBoundingClientRect();
  const style = getComputedStyle(field);
  const mirror = document.createElement('div');
  for (const key of [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'letterSpacing',
    'lineHeight',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'textAlign',
    'textIndent',
    'wordSpacing',
    'tabSize',
    'boxSizing',
  ] as const)
    mirror.style[key] = style[key];
  Object.assign(mirror.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    whiteSpace: field instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre',
    overflowWrap: 'break-word',
    overflow: 'hidden',
    visibility: 'hidden',
    pointerEvents: 'none',
    borderStyle: 'solid',
  });
  let end = 0;
  const spans: { name: string; element: HTMLSpanElement }[] = [];
  for (const match of field.value.matchAll(/\{\{([^{}]+)\}\}/g)) {
    mirror.append(document.createTextNode(field.value.slice(end, match.index)));
    const element = document.createElement('span');
    element.textContent = match[0];
    mirror.append(element);
    spans.push({ name: match[1].trim(), element });
    end = match.index + match[0].length;
  }
  mirror.append(document.createTextNode(field.value.slice(end)));
  document.body.append(mirror);
  mirror.scrollTop = field.scrollTop;
  mirror.scrollLeft = field.scrollLeft;
  const hit = spans.find(({ element }) =>
    [...element.getClientRects()].some(
      (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
    ),
  );
  mirror.remove();
  return hit?.name;
}

export function VariableInspector({
  resolve,
  onSave,
  onDeleteVariable,
  onRenameVariable,
  onNavigateVariable,
  scopeKey,
  getCreationTargets,
  onCreateVariable,
}: {
  resolve: (name: string, owner: HTMLElement) => ScopedVariable | undefined;
  onSave: (variable: ScopedVariable, value: string, secret: boolean) => void;
  onDeleteVariable?: (variable: ScopedVariable, name: string) => void;
  onRenameVariable?: (variable: ScopedVariable, name: string) => void;
  onNavigateVariable?: (variable: ScopedVariable, location?: VariableReferenceLocation) => void;
  scopeKey: string;
  getCreationTargets?: (owner: HTMLElement) => VariableTarget[];
  onCreateVariable?: VariableCreation['onCreateVariable'];
}) {
  const [reference, setReference] = useState<Reference>();
  const popup = useRef<HTMLDivElement>(null);
  const latest = useRef(reference);
  latest.current = reference;
  const actions = useRef({ resolve, onNavigateVariable });
  actions.current = { resolve, onNavigateVariable };
  useEffect(() => setReference(undefined), [scopeKey]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingLocation: { icon: HTMLElement; location?: VariableReferenceLocation } | undefined;
    function clearTimer() {
      clearTimeout(timer);
      timer = undefined;
    }
    function close() {
      clearTimer();
      setReference(undefined);
    }
    function move(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-variable-origin-icon]')) {
        close();
        return;
      }
      if (target instanceof HTMLElement && target.closest('.url-variable-popover')) {
        clearTimer();
        return;
      }
      if (
        !(target instanceof HTMLElement) ||
        target.closest('.url-variable-popover, .variable-url')
      )
        return;
      if (popup.current?.contains(document.activeElement) || event.buttons) {
        clearTimer();
        return;
      }
      let name: string | undefined;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        name = fieldReference(target, event.clientX, event.clientY);
      } else {
        const cm = target.closest('.cm-editor');
        const view = cm ? EditorView.findFromDOM(cm as HTMLElement) : null;
        if (view) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos !== null) name = tokenAt(view.state.doc.toString(), pos);
        } else {
          const range = document.caretRangeFromPoint(event.clientX, event.clientY);
          if (
            range?.startContainer.nodeType === Node.TEXT_NODE &&
            target.contains(range.startContainer)
          )
            name = tokenAt(range.startContainer.textContent ?? '', range.startOffset);
          if (target.dataset.variableReference) name = target.dataset.variableReference;
        }
      }
      if (!name) {
        if (!timer) timer = setTimeout(close, 250);
        return;
      }
      clearTimer();
      if (latest.current?.name === name && latest.current.owner === target) return;
      setReference({
        name,
        owner: target,
        left: event.clientX,
        top: event.clientY + 12,
        keyboard: false,
      });
    }
    function key(event: KeyboardEvent) {
      const target = event.target;
      if (event.key === 'Escape' && latest.current) {
        event.preventDefault();
        event.stopPropagation();
        const owner = latest.current.owner;
        close();
        owner.focus();
        return;
      }
      if (
        !event.altKey ||
        event.key !== 'ArrowDown' ||
        !(target instanceof HTMLElement) ||
        target.closest('.variable-url, .url-variable-popover')
      )
        return;
      let name: string | undefined;
      if (target.dataset.variableReference) name = target.dataset.variableReference;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        name = tokenAt(target.value, target.selectionStart ?? 0);
      } else {
        const cm = target.closest('.cm-editor');
        const view = cm ? EditorView.findFromDOM(cm as HTMLElement) : null;
        if (view) name = tokenAt(view.state.doc.toString(), view.state.selection.main.head);
      }
      if (!name) return;
      event.preventDefault();
      const bounds = target.getBoundingClientRect();
      setReference({
        name,
        owner: target,
        left: bounds.left,
        top: Math.min(bounds.bottom, innerHeight - 220),
        keyboard: true,
      });
    }
    function outside(event: PointerEvent) {
      const icon =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-variable-origin-icon]')
          : null;
      pendingLocation = icon ? { icon, location: captureVariableReference(icon) } : undefined;
      if (!popup.current?.contains(event.target as Node)) close();
    }
    function scroll(event: Event) {
      if (!popup.current?.contains(event.target as Node)) close();
    }
    function focus(event: FocusEvent) {
      if (event.target !== latest.current?.owner && !popup.current?.contains(event.target as Node))
        close();
    }
    function navigate(event: MouseEvent) {
      const icon =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-variable-origin-icon]')
          : null;
      const name = icon?.dataset.variableReference;
      if (!icon || !name || !actions.current.onNavigateVariable) return;
      const variable = actions.current.resolve(name, icon);
      if (!variable || !['collection', 'environment'].includes(variable.source)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      const location =
        pendingLocation?.icon === icon ? pendingLocation.location : captureVariableReference(icon);
      pendingLocation = undefined;
      actions.current.onNavigateVariable(variable, location);
    }
    document.addEventListener('click', navigate, true);
    document.addEventListener('mousemove', move);
    document.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('focusin', focus);
    window.addEventListener('resize', close);
    return () => {
      clearTimer();
      document.removeEventListener('click', navigate, true);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('focusin', focus);
      window.removeEventListener('resize', close);
    };
  }, []);
  useEffect(() => {
    const element = popup.current;
    if (reference && element && !element.matches(':popover-open')) element.showPopover();
    if (reference && element)
      element.style.top = `${Math.max(8, Math.min(reference.top, innerHeight - element.offsetHeight - 8))}px`;
    if (reference?.keyboard) element?.querySelector('input')?.focus();
  }, [reference]);
  if (!reference || !reference.owner.isConnected) return null;
  const variable = resolve(reference.name, reference.owner);
  return createPortal(
    <div
      ref={popup}
      popover="manual"
      className="url-variable-popover global-variable-popover"
      style={{
        left: Math.max(8, Math.min(reference.left, innerWidth - 368)),
        top: Math.max(8, Math.min(reference.top, innerHeight - 200)),
      }}
      role="dialog"
      aria-label={t('Valor de {0}', reference.name)}
    >
      <VariableValue
        key={JSON.stringify([
          reference.name,
          variable?.id,
          variable?.source,
          variable?.collectionId,
          variable?.environmentId,
        ])}
        name={reference.name}
        creationTargets={getCreationTargets?.(reference.owner)}
        onCreateVariable={
          onCreateVariable
            ? (name, value, target, secret) => {
                onCreateVariable(name, value, target, secret);
                setReference(undefined);
                reference.owner.focus();
              }
            : undefined
        }
        variable={variable}
        onDelete={
          variable && onDeleteVariable
            ? () => {
                onDeleteVariable(variable, reference.name);
                setReference(undefined);
                reference.owner.focus();
              }
            : undefined
        }
        onRename={
          variable && onRenameVariable
            ? () => {
                onRenameVariable(variable, reference.name);
                setReference(undefined);
                reference.owner.focus();
              }
            : undefined
        }
        label={variable?.label ?? t('Ausente')}
        autoFocus={reference.keyboard}
        onSave={(value, secret) => {
          if (variable) onSave(variable, value, secret);
          setReference(undefined);
          reference.owner.focus();
        }}
      />
    </div>,
    reference.owner.closest('[role="dialog"]') ?? document.body,
  );
}

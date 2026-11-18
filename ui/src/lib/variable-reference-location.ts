import { EditorView } from 'codemirror';

type ScrollPosition = { top: number; left: number };
export type VariableReferenceLocation = {
  kind: 'input' | 'codemirror';
  fieldIndex: number;
  occurrence: number;
  name: string;
  offset: number;
  fieldScroll: ScrollPosition;
  scrolls: { path: number[]; position: ScrollPosition }[];
  main?: ScrollPosition;
  window: ScrollPosition;
};
const position = (element: Element): ScrollPosition => ({
  top: element.scrollTop,
  left: element.scrollLeft,
});
function inputs(root: HTMLElement) {
  return [
    ...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea'),
  ].filter(
    (input) =>
      !input.closest('.url-variable-popover') &&
      (!(input instanceof HTMLInputElement) ||
        !['checkbox', 'radio', 'hidden', 'file'].includes(input.type)),
  );
}
function pathTo(root: HTMLElement, element: Element) {
  const path: number[] = [];
  let current: Element | null = element;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) return undefined;
    path.unshift([...parent.children].indexOf(current));
    current = parent;
  }
  return current === root ? path : undefined;
}
function atPath(root: HTMLElement, path: number[]) {
  let element: Element | undefined = root;
  for (const index of path) element = element?.children[index];
  return element;
}
export function captureVariableReference(icon: HTMLElement): VariableReferenceLocation | undefined {
  const root = icon.closest<HTMLElement>('[data-request-editor]');
  const name = icon.dataset.variableReference;
  if (!root || !name) return;
  const cm = icon.closest<HTMLElement>('.cm-editor');
  const view = cm ? EditorView.findFromDOM(cm) : undefined;
  const field =
    view?.contentDOM ??
    icon
      .closest('.variable-url,.variable-origin-field,.pair-value')
      ?.querySelector<HTMLInputElement>('input');
  if (!field) return;
  const fieldIndex = view
    ? [...root.querySelectorAll('.cm-editor')].indexOf(view.dom)
    : inputs(root).indexOf(field as HTMLInputElement);
  if (fieldIndex < 0) return;
  const text = view ? view.state.doc.toString() : (field as HTMLInputElement).value;
  const offset = Number(icon.dataset.variableOffset ?? 0);
  const tokens = [...text.matchAll(/\{\{([^{}]+)\}\}/g)];
  const occurrence = tokens.findIndex((token) => token.index === offset);
  const scrolls: VariableReferenceLocation['scrolls'] = [];
  let current: Element | null = view ? view.dom.parentElement : field.parentElement;
  while (current && root.contains(current)) {
    const path = pathTo(root, current);
    if (path) scrolls.push({ path, position: position(current) });
    if (current === root) break;
    current = current.parentElement;
  }
  const main = root.closest('.main-content');
  return {
    kind: view ? 'codemirror' : 'input',
    fieldIndex,
    occurrence: Math.max(0, occurrence),
    name,
    offset,
    fieldScroll: position(view?.scrollDOM ?? field),
    scrolls,
    main: main ? position(main) : undefined,
    window: { top: window.scrollY, left: window.scrollX },
  };
}

// Selection and decorations stay outside the document, so returning never edits the request.
export function restoreVariableReference(
  root: HTMLElement,
  location: VariableReferenceLocation,
): (() => void) | undefined {
  const cm =
    location.kind === 'codemirror'
      ? root.querySelectorAll<HTMLElement>('.cm-editor')[location.fieldIndex]
      : undefined;
  const view = cm ? EditorView.findFromDOM(cm) : undefined;
  const input = location.kind === 'input' ? inputs(root)[location.fieldIndex] : undefined;
  if (!view && !input) return;
  const text = view ? view.state.doc.toString() : input!.value;
  const tokens = [...text.matchAll(/\{\{([^{}]+)\}\}/g)];
  const token =
    tokens[location.occurrence] ?? tokens.find((match) => match[1].trim() === location.name);
  const from = token?.index ?? Math.min(location.offset, text.length);
  const to = token ? from + token[0].length : from;
  if (view) {
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: false });
    view.contentDOM.focus({ preventScroll: true });
  } else if (input) {
    input.focus({ preventScroll: true });
    input.setSelectionRange(from, to);
  }
  const apply = () => {
    if (!root.isConnected) return;
    for (const scroll of location.scrolls) {
      const element = atPath(root, scroll.path);
      if (element) {
        element.scrollTop = scroll.position.top;
        element.scrollLeft = scroll.position.left;
        element.dispatchEvent(new Event('scroll'));
      }
    }
    const main = root.closest('.main-content');
    if (main && location.main) {
      main.scrollTop = location.main.top;
      main.scrollLeft = location.main.left;
    }
    const field = view?.scrollDOM ?? input;
    if (field) {
      field.scrollTop = location.fieldScroll.top;
      field.scrollLeft = location.fieldScroll.left;
      field.dispatchEvent(new Event('scroll'));
    }
    window.scrollTo(location.window.left, location.window.top);
  };
  apply();
  if (view) view.requestMeasure({ read: () => null, write: apply });
  return apply;
}

import { StateEffect } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { variableOriginLabel, type EditableVariable } from './VariableUrlInput';

type Source = EditableVariable['source'];
export const refreshVariableOrigins = StateEffect.define<null>();

class OriginWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly source: Source | undefined,
    readonly originLabel: string,
    readonly icon: (source?: Source) => Element | undefined,
    readonly offset: number,
  ) {
    super();
  }
  eq(other: OriginWidget) {
    return (
      this.name === other.name &&
      this.source === other.source &&
      this.originLabel === other.originLabel &&
      this.offset === other.offset
    );
  }
  toDOM() {
    const canNavigate = this.source === 'collection' || this.source === 'environment';
    const element = document.createElement(canNavigate ? 'button' : 'span');
    if (element instanceof HTMLButtonElement) {
      element.type = 'button';
      element.setAttribute('aria-label', this.name + ' · ' + this.originLabel);
    }
    element.className = 'body-variable-origin';
    element.dataset.variableReference = this.name;
    element.dataset.variableSource = this.source ?? 'missing';
    element.title = this.originLabel;
    element.dataset.variableOriginIcon = 'true';
    element.dataset.variableOffset = String(this.offset);
    if (!canNavigate) element.setAttribute('aria-hidden', 'true');
    const icon = this.icon(this.source);
    if (icon) element.append(icon.cloneNode(true));
    return element;
  }
  ignoreEvent() {
    return true;
  }
}

export function variableOriginDecorations(
  resolve: (name: string) => EditableVariable | undefined,
  icon: (source?: Source) => Element | undefined,
) {
  function decorate(view: EditorView) {
    const ranges = [];
    for (const match of view.state.doc.toString().matchAll(/\{\{([^{}]+)\}\}/g)) {
      const name = match[1].trim();
      const variable = resolve(name);
      const source = variable?.source;
      ranges.push(
        Decoration.widget({
          widget: new OriginWidget(name, source, variableOriginLabel(variable), icon, match.index),
          side: -1,
        }).range(match.index),
      );
      ranges.push(
        Decoration.mark({
          class: 'body-variable-reference',
          attributes: { 'data-variable-source': source ?? 'missing' },
        }).range(match.index, match.index + match[0].length),
      );
    }
    return Decoration.set(ranges, true);
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(refreshVariableOrigins)),
          )
        )
          this.decorations = decorate(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

import { useLayoutEffect, useRef } from 'react';
import { VariableOriginBadge, type EditableVariable } from './VariableUrlInput';

export function VariableFieldOrigins({
  value,
  resolveVariable,
  masked = false,
}: {
  value: string;
  resolveVariable?: (name: string) => EditableVariable | undefined;
  masked?: boolean;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = mirror.current;
    const input = root?.parentElement?.querySelector('input:not([type="checkbox"])');
    if (!root || !(input instanceof HTMLInputElement)) return;
    const position = () => {
      const style = getComputedStyle(input);
      Object.assign(root.style, {
        left: `${input.offsetLeft}px`,
        top: `${input.offsetTop}px`,
        width: `${input.offsetWidth}px`,
        height: `${input.offsetHeight}px`,
        font: style.font,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        padding: style.padding,
        borderWidth: style.borderWidth,
        borderStyle: 'solid',
        borderColor: 'transparent',
        boxSizing: style.boxSizing,
      });
    };
    const scroll = () => {
      if (text.current) text.current.style.transform = `translateX(${-input.scrollLeft}px)`;
    };
    position();
    scroll();
    const resize = new ResizeObserver(position);
    resize.observe(input);
    input.addEventListener('scroll', scroll);
    return () => {
      resize.disconnect();
      input.removeEventListener('scroll', scroll);
    };
  }, [value, resolveVariable, masked]);
  if (!resolveVariable || masked || !value.includes('{{')) return null;
  let end = 0;
  const tokens = [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => {
    const before = value.slice(end, match.index);
    end = match.index + match[0].length;
    const variable = resolveVariable(match[1].trim());
    const source = variable?.source;
    return (
      <span key={match.index}>
        <span aria-hidden="true">{before}</span>
        <span className="url-variable-token" data-variable-source={source ?? 'missing'}>
          <VariableOriginBadge name={match[1].trim()} variable={variable} offset={match.index} />
          <span aria-hidden="true">{match[0]}</span>
        </span>
      </span>
    );
  });
  return (
    <div ref={mirror} className="field-variable-mirror">
      <span ref={text}>
        {tokens}
        <span aria-hidden="true">{value.slice(end)}</span>
      </span>
    </div>
  );
}

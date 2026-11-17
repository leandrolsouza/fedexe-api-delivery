import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { formatNumber, t, type Message } from '../lib/i18n';
import type { LoadInterval } from '../lib/load-runner';

const charts = [
  ['rps', 'Requisições/s (RPS)'],
  ['p95_ms', 'p95 (ms)'],
  ['p99_ms', 'p99 (ms)'],
  ['error_percent', 'Taxa de erros (%)'],
] as const satisfies ReadonlyArray<[keyof LoadInterval, Message]>;

const number = (value: number) => formatNumber(value, { maximumFractionDigits: 2 });
const seconds = (ms: number) => formatNumber(ms / 1_000, { maximumFractionDigits: 3 }) + ' s';
const margin = 5;

type ChartProps = {
  metric: (typeof charts)[number][0];
  label: string;
  points: LoadInterval[];
  selected: LoadInterval;
  firstError: number | null;
  onSelect: (index: number) => void;
};

function Chart({ metric, label, points, selected, firstError, onSelect }: ChartProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const end = Math.max(1, points.at(-1)!.end_ms);
  const peak = Math.max(0, ...points.map((point) => point[metric] ?? 0));
  const maximum = metric === 'error_percent' ? 100 : Math.max(1, Math.ceil(peak));

  useEffect(() => {
    const element = canvas.current!;
    const draw = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= margin * 2 || height <= margin * 2) return;
      const scale = window.devicePixelRatio || 1;
      element.width = Math.round(width * scale);
      element.height = Math.round(height * scale);
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.scale(scale, scale);
      const x = (ms: number) => margin + (ms / end) * (width - margin * 2);
      const y = (value: number) => height - margin - (value / maximum) * (height - margin * 2);

      ctx.fillStyle = 'rgba(132, 105, 224, 0.13)';
      ctx.fillRect(
        x(selected.start_ms),
        margin,
        Math.max(1, x(selected.end_ms) - x(selected.start_ms)),
        height - margin * 2,
      );
      ctx.strokeStyle = 'rgba(122, 132, 154, 0.35)';
      ctx.beginPath();
      for (const level of [0, maximum / 2, maximum]) {
        ctx.moveTo(x(0), y(level));
        ctx.lineTo(x(end), y(level));
      }
      ctx.stroke();

      ctx.strokeStyle = '#8265df';
      ctx.lineWidth = 2;
      ctx.beginPath();
      let previous = false;
      for (const point of points) {
        const value = point[metric];
        if (value === null) {
          previous = false;
          continue;
        }
        if (previous) ctx.lineTo(x(point.start_ms), y(value));
        else ctx.moveTo(x(point.start_ms), y(value));
        ctx.lineTo(Math.max(x(point.start_ms) + 1, x(point.end_ms)), y(value));
        previous = true;
      }
      ctx.stroke();

      if (firstError !== null) {
        ctx.strokeStyle = '#d74564';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x(firstError), margin);
        ctx.lineTo(x(firstError), height - margin);
        ctx.stroke();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [end, firstError, maximum, metric, points, selected]);

  function selectAt(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left - margin) / Math.max(1, rect.width - margin * 2);
    const index = points.findIndex((point) => fraction * end < point.end_ms);
    onSelect(index < 0 ? points.length - 1 : index);
  }

  return (
    <figure className="load-chart">
      <figcaption>{label}</figcaption>
      <div className="load-chart-plot">
        <div className="load-chart-scale" aria-hidden="true">
          <span>{number(maximum)}</span>
          <span>0</span>
        </div>
        <canvas
          ref={canvas}
          aria-hidden="true"
          onPointerDown={selectAt}
          onPointerMove={(event) => {
            if (event.pointerType === 'mouse') selectAt(event);
          }}
        />
      </div>
      <div className="load-chart-time" aria-hidden="true">
        <span>0 s</span>
        <span>{seconds(end)}</span>
      </div>
    </figure>
  );
}

export function LoadTimeline({ points }: { points: LoadInterval[] }) {
  const [index, setIndex] = useState<number>();
  if (!points.length)
    return (
      <p className="field-hint">{t('A evolução aparece após a primeira janela de medição.')}</p>
    );
  const firstErrorIndex = points.findIndex((point) => point.first_error_ms !== null);
  const firstError = points[firstErrorIndex]?.first_error_ms ?? null;
  const current = Math.min(
    index ?? (firstErrorIndex < 0 ? points.length - 1 : firstErrorIndex),
    points.length - 1,
  );
  const selected = points[current];
  const cardLabel = t('Janela de {0} a {1}', seconds(selected.start_ms), seconds(selected.end_ms));

  return (
    <div className="load-evolution">
      <p className={firstError === null ? 'field-hint' : 'load-first-error'}>
        {firstError === null
          ? t('Nenhum erro HTTP ou de transporte registrado.')
          : t('Primeiro erro registrado em {0}', seconds(firstError))}
      </p>
      <div className="load-charts">
        {charts.map(([metric, label]) => (
          <Chart
            key={metric}
            metric={metric}
            label={t(label)}
            points={points}
            selected={selected}
            firstError={firstError}
            onSelect={setIndex}
          />
        ))}
      </div>
      <div className="load-window">
        <label>
          {cardLabel}
          <input
            type="range"
            min={0}
            max={points.length - 1}
            value={current}
            disabled={points.length < 2}
            aria-label={t('Selecionar janela de medição')}
            aria-valuetext={cardLabel}
            onChange={(event) => setIndex(Number(event.target.value))}
          />
        </label>
        {firstErrorIndex >= 0 && current !== firstErrorIndex && (
          <button type="button" className="button" onClick={() => setIndex(firstErrorIndex)}>
            {t('Ir ao primeiro erro')}
          </button>
        )}
      </div>
      <dl className="load-window-values">
        {charts.map(([metric, label]) => (
          <div key={metric}>
            <dt>{t(label)}</dt>
            <dd>{selected[metric] === null ? '—' : number(selected[metric])}</dd>
          </div>
        ))}
        <div>
          <dt>{t('Chamadas')}</dt>
          <dd>{number(selected.requests)}</dd>
        </div>
        <div>
          <dt>{t('Erros HTTP ou de transporte')}</dt>
          <dd>{number(selected.errors)}</dd>
        </div>
      </dl>
    </div>
  );
}

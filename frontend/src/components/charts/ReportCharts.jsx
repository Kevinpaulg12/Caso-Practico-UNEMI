// Gráficas del informe del odontólogo, dibujadas y animadas con D3.
import { useEffect, useId, useRef, useState } from 'react';
import { easeCubicOut, scaleBand, scaleLinear, select } from 'd3';
import 'd3-transition';
import ChartTooltipBox from './ChartTooltipBox';
import { MARGIN, highlightDay, renderLineChart } from './lineChart';
import useChartWidth, { prefersReducedMotion } from './useChartWidth';
import { HOVER, INK, REPORTED, THRESHOLD } from './chartTheme';

const TOOLTIP_WIDTH = 190;

// EVA promedio de todos los pacientes por día de seguimiento, con el umbral de riesgo alto.
export function PainByDayChart({ data, threshold, height = 240 }) {
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const geometry = useRef(null);
  const drawn = useRef(false);
  const width = useChartWidth(boxRef);
  const [activeDay, setActiveDay] = useState(null);
  const chartId = `avg-${useId().replace(/:/g, '')}`;
  const dataKey = JSON.stringify([data, threshold]);
  const lastDay = data.length ? Math.max(...data.map((item) => item.day)) : 0;

  useEffect(() => {
    if (!width || !svgRef.current) return;
    geometry.current = renderLineChart(svgRef.current, {
      width,
      height,
      lastDay,
      gradientId: chartId,
      animate: !drawn.current,
      reducedMotion: prefersReducedMotion(),
      onActivate: setActiveDay,
      onLeave: () => setActiveDay(null),
      threshold: { value: threshold, color: THRESHOLD },
      margin: { ...MARGIN, right: 16 },
      lines: [{
        key: 'average', color: REPORTED, width: 2.5, area: true, dots: true,
        points: data.map((item) => ({ day: item.day, value: item.average, fill: item.average >= threshold ? THRESHOLD : REPORTED })),
      }],
    });
    drawn.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, dataKey, chartId]);

  useEffect(() => { highlightDay(svgRef.current, geometry.current, activeDay); }, [activeDay]);

  const days = data.map((item) => item.day);
  const point = data.find((item) => item.day === activeDay);
  const onKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !days.length) return;
    event.preventDefault();
    const index = days.indexOf(activeDay);
    setActiveDay(days[event.key === 'ArrowRight'
      ? (index < 0 ? 0 : Math.min(index + 1, days.length - 1))
      : (index < 0 ? days.length - 1 : Math.max(index - 1, 0))]);
  };
  const pointX = point && geometry.current ? MARGIN.left + geometry.current.x(point.day) : 0;
  const left = pointX + 12 + TOOLTIP_WIDTH <= width ? pointX + 12 : Math.max(pointX - 12 - TOOLTIP_WIDTH, 0);

  return (
    <div>
      <div ref={boxRef} className="relative mt-4 w-full" style={{ height }}>
        <svg
          ref={svgRef}
          role="img"
          aria-label={`EVA promedio en ${data.length} días de seguimiento; la línea discontinua marca el riesgo alto (EVA ${threshold}). La tabla siguiente contiene los mismos datos. Usa las flechas para recorrer los días.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActiveDay(null)}
          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        />
        {point && (
          <div className="pointer-events-none absolute z-10" style={{ left, top: MARGIN.top, width: TOOLTIP_WIDTH }}>
            <ChartTooltipBox title={`Día ${point.day}`}>
              <p className="mt-1">EVA promedio {point.average} · {point.reports} {point.reports === 1 ? 'reporte' : 'reportes'}</p>
              {point.average >= threshold && <p className="mt-0.5 font-semibold text-rose-700">Supera el umbral de riesgo alto</p>}
            </ChartTooltipBox>
          </div>
        )}
      </div>
      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-blue-700">Ver datos en tabla</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-[10px] uppercase tracking-wider text-slate-400">
            <tr><th scope="col" className="py-1">Día</th><th scope="col">EVA promedio</th><th scope="col">Reportes</th></tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.day} className="border-t border-slate-100">
                <td className="py-1">{item.day}</td>
                <td>{item.average}</td>
                <td>{item.reports}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

const BAR = { label: 116, value: 32, row: 40 };

function renderBars(svgNode, { width, data, animate, reducedMotion, onActivate, onLeave }) {
  const height = data.length * BAR.row;
  const innerWidth = Math.max(width - BAR.label - BAR.value, 0);
  const x = scaleLinear().domain([0, Math.max(...data.map((item) => item.count), 1)]).range([0, innerWidth]);
  const y = scaleBand().domain(data.map((item) => item.label)).range([0, height]).paddingInner(0.35).paddingOuter(0.2);
  const duration = reducedMotion ? 0 : 600;

  const svg = select(svgNode).attr('width', width).attr('height', height);
  const rows = svg.selectAll('g.row').data(data, (item) => item.label)
    .join((enter) => {
      const row = enter.append('g').attr('class', 'row').attr('transform', (item) => `translate(0,${y(item.label)})`);
      row.append('rect').attr('class', 'hover');
      row.append('text').attr('class', 'label');
      row.append('rect').attr('class', 'bar').attr('x', BAR.label).attr('width', 0);
      row.append('text').attr('class', 'value');
      return row;
    });
  rows.on('pointerenter', (_, item) => onActivate(item.label)).on('pointerleave', () => onLeave());
  rows.transition().duration(duration).attr('transform', (item) => `translate(0,${y(item.label)})`);

  rows.select('rect.hover')
    .attr('x', 0).attr('y', -y.step() * 0.175).attr('width', width).attr('height', y.step()).attr('rx', 6)
    .attr('fill', 'transparent');
  rows.select('text.label')
    .attr('x', BAR.label - 10).attr('y', y.bandwidth() / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
    .attr('font-size', 11).attr('fill', INK).text((item) => item.label);
  const bars = rows.select('rect.bar')
    .attr('y', 0).attr('height', y.bandwidth()).attr('rx', 4).attr('fill', REPORTED);
  const values = rows.select('text.value')
    .attr('y', y.bandwidth() / 2).attr('dy', '0.32em').attr('font-size', 11).attr('font-weight', 700).attr('fill', INK)
    .text((item) => item.count);

  if (animate && !reducedMotion) {
    bars.attr('width', 0);
    values.attr('x', BAR.label + 6);
  }
  // Las barras crecen desde la base; al cambiar el periodo se ajustan a su nuevo valor.
  bars.transition().duration(duration).ease(easeCubicOut).attr('width', (item) => Math.max(x(item.count), 2));
  values.transition().duration(duration).ease(easeCubicOut).attr('x', (item) => BAR.label + Math.max(x(item.count), 2) + 6);
  return height;
}

// Signos de alarma más mencionados: barras horizontales con el valor al final de cada una.
export function SymptomChart({ data }) {
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const drawn = useRef(false);
  const width = useChartWidth(boxRef);
  const [active, setActive] = useState(null);
  const dataKey = JSON.stringify(data);

  useEffect(() => {
    if (!width || !svgRef.current) return;
    renderBars(svgRef.current, {
      width, data, animate: !drawn.current, reducedMotion: prefersReducedMotion(),
      onActivate: setActive, onLeave: () => setActive(null),
    });
    drawn.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, dataKey]);

  useEffect(() => {
    select(svgRef.current).selectAll('g.row').select('rect.hover')
      .attr('fill', (item) => (item.label === active ? HOVER : 'transparent'));
  }, [active]);

  const item = data.find((entry) => entry.label === active);
  return (
    <div
      ref={boxRef}
      className="relative mt-4 w-full"
      style={{ minHeight: data.length * BAR.row }}
      role="img"
      aria-label={data.map((entry) => `${entry.label}: ${entry.count}`).join('; ')}
    >
      <svg ref={svgRef} aria-hidden="true" className="block" />
      {item && (
        <div className="pointer-events-none absolute right-0 top-0 z-10">
          <ChartTooltipBox title={item.label}>
            <p className="mt-1">Mencionado en {item.count} {item.count === 1 ? 'reporte' : 'reportes'}</p>
          </ChartTooltipBox>
        </div>
      )}
    </div>
  );
}

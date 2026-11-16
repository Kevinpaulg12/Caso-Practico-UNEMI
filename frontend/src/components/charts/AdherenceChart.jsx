// Cumplimiento de los cuidados por día (0–100 %), dibujado con D3.
import { useEffect, useRef } from 'react';
import { easeCubicOut, scaleBand, scaleLinear, select } from 'd3';
import 'd3-transition';
import useChartWidth, { prefersReducedMotion } from './useChartWidth';
import { GRID, INK, INK_MUTED, REPORTED, THRESHOLD } from './chartTheme';

const MARGIN = { top: 16, right: 8, bottom: 26, left: 34 };
const HEIGHT = 170;
const LOW = 60;

const dayLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'numeric' });

export default function AdherenceChart({ checkins }) {
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const drawn = useRef(false);
  const width = useChartWidth(boxRef);
  const data = [...checkins].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  const dataKey = JSON.stringify(data.map((item) => [item.date, item.adherence]));

  useEffect(() => {
    if (!width || !svgRef.current || !data.length) return;
    const innerWidth = Math.max(width - MARGIN.left - MARGIN.right, 0);
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const x = scaleBand().domain(data.map((item) => item.date)).range([0, innerWidth]).padding(0.3);
    const y = scaleLinear().domain([0, 100]).range([innerHeight, 0]);
    const duration = prefersReducedMotion() ? 0 : 600;

    const svg = select(svgRef.current).attr('width', width).attr('height', HEIGHT);
    const root = svg.selectAll('g.root').data([null]).join('g').attr('class', 'root')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

    root.selectAll('g.grid').data([0, 50, 100]).join((enter) => {
      const tick = enter.append('g').attr('class', 'grid');
      tick.append('line');
      tick.append('text');
      return tick;
    })
      .attr('transform', (value) => `translate(0,${y(value)})`)
      .call((tick) => tick.select('line').attr('x2', innerWidth).attr('stroke', GRID).attr('stroke-dasharray', (value) => (value ? '2 4' : null)))
      .call((tick) => tick.select('text').attr('x', -8).attr('dy', '0.32em').attr('text-anchor', 'end').attr('font-size', 11)
        .attr('fill', INK_MUTED).text((value) => `${value}%`));

    const bars = root.selectAll('rect.bar').data(data, (item) => item.date)
      .join((enter) => enter.append('rect').attr('class', 'bar').attr('y', innerHeight).attr('height', 0))
      .attr('x', (item) => x(item.date)).attr('width', x.bandwidth()).attr('rx', 4)
      .attr('fill', (item) => (item.adherence < LOW ? THRESHOLD : REPORTED));
    bars.selectAll('title').data((item) => [item]).join('title').text((item) => `${dayLabel(item.date)}: ${item.adherence} %`);
    bars.transition().duration(drawn.current ? duration / 2 : duration).ease(easeCubicOut)
      // Un día al 0 % se ve como una línea roja: se registró, pero no se cumplió nada.
      .attr('y', (item) => Math.min(y(item.adherence), innerHeight - 3)).attr('height', (item) => Math.max(innerHeight - y(item.adherence), 3));

    root.selectAll('text.value').data(data, (item) => item.date).join('text').attr('class', 'value')
      .attr('x', (item) => x(item.date) + x.bandwidth() / 2).attr('y', (item) => y(item.adherence) - 4)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('font-weight', 700).attr('fill', INK)
      .text((item) => (x.bandwidth() >= 22 ? item.adherence : ''));

    root.selectAll('text.day').data(data, (item) => item.date).join('text').attr('class', 'day')
      .attr('x', (item) => x(item.date) + x.bandwidth() / 2).attr('y', innerHeight + 16)
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('fill', INK_MUTED)
      .text((item, index) => (data.length <= 7 || index % 2 === 0 ? dayLabel(item.date) : ''));
    drawn.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, dataKey]);

  if (!data.length) {
    return <p className="mt-3 rounded-xl bg-slate-50 py-5 text-center text-xs text-slate-400">Aún no hay días registrados.</p>;
  }
  const average = Math.round(data.reduce((sum, item) => sum + item.adherence, 0) / data.length);
  return (
    <div>
      <div ref={boxRef} className="mt-3 w-full" style={{ height: HEIGHT }}>
        <svg ref={svgRef} role="img" aria-label={`Cumplimiento de cuidados en ${data.length} días: promedio ${average} %. Las barras rojas son días por debajo del ${LOW} %.`} className="block" />
      </div>
      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-blue-700">Ver datos en tabla</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr><th scope="col" className="py-1">Día</th><th scope="col">Cumplimiento</th></tr></thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.date} className="border-t border-slate-100"><td className="py-1">{dayLabel(item.date)}</td><td>{item.adherence} %</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

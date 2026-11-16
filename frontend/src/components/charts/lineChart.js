// Gráfica de líneas por día de seguimiento dibujada con D3: D3 es dueño del SVG (join + transiciones);
// React solo aporta el contenedor, el tooltip y la tabla equivalente.
import { area, curveMonotoneX, easeCubicOut, line, pointer, scaleLinear, select } from 'd3';
// `d3` se declara sin efectos secundarios: sin esta importación explícita el build de producción
// elimina d3-transition y selection.transition()/interrupt() dejan de existir.
import 'd3-transition';
import { EVA_TICKS, GRID, INK_MUTED } from './chartTheme';

export const MARGIN = { top: 14, right: 76, bottom: 28, left: 30 };
const ENTER_MS = 900;
const UPDATE_MS = 450;

// Separa las etiquetas finales si caen casi a la misma altura.
function spreadLabels(labels, gap = 14) {
  const sorted = [...labels].sort((a, b) => a.y - b.y);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].y - sorted[index - 1].y < gap) sorted[index].y = sorted[index - 1].y + gap;
  }
  return labels;
}

/**
 * Dibuja (o actualiza con transición) la gráfica dentro de `svgNode`.
 * lines: [{ key, color, dashed, width, area, dots, endLabel, endLabelColor, points: [{ day, value, fill }] }]
 * Devuelve la geometría para resaltar el día activo.
 */
export function renderLineChart(svgNode, {
  width, height, lastDay, lines, threshold, gradientId, animate, reducedMotion, onActivate, onLeave, margin = MARGIN,
}) {
  const innerWidth = Math.max(width - margin.left - margin.right, 0);
  const innerHeight = height - margin.top - margin.bottom;
  const x = scaleLinear().domain([0, Math.max(lastDay, 1)]).range([0, innerWidth]);
  const y = scaleLinear().domain([0, 10]).range([innerHeight, 0]);
  const duration = reducedMotion ? 0 : UPDATE_MS;

  const svg = select(svgNode).attr('width', width).attr('height', height);

  // Degradado del área y recorte para la animación de entrada.
  const defs = svg.selectAll('defs').data([null]).join('defs');
  const gradient = defs.selectAll('linearGradient').data([null]).join('linearGradient')
    .attr('id', `${gradientId}-area`).attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
  gradient.selectAll('stop').data([[0, 0.22], [1, 0]]).join('stop')
    .attr('offset', ([offset]) => `${offset * 100}%`)
    .attr('stop-color', lines.find((item) => item.area)?.color ?? '#2563eb')
    .attr('stop-opacity', ([, opacity]) => opacity);
  const clipRect = defs.selectAll('clipPath').data([null]).join('clipPath').attr('id', `${gradientId}-clip`)
    .selectAll('rect').data([null]).join('rect')
    .attr('x', -8).attr('y', -8).attr('height', innerHeight + 16);

  const root = svg.selectAll('g.chart-root').data([null]).join('g')
    .attr('class', 'chart-root')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Rejilla y eje Y (EVA 0–10).
  root.selectAll('g.y-grid').data([null]).join('g').attr('class', 'y-grid')
    .selectAll('g.tick').data(EVA_TICKS).join((enter) => {
      const tick = enter.append('g').attr('class', 'tick');
      tick.append('line');
      tick.append('text');
      return tick;
    })
    .attr('transform', (tick) => `translate(0,${y(tick)})`)
    .call((tick) => tick.select('line').attr('x2', innerWidth).attr('stroke', GRID).attr('stroke-dasharray', (value) => (value === 0 ? null : '2 4')))
    .call((tick) => tick.select('text').attr('x', -10).attr('dy', '0.32em').attr('text-anchor', 'end')
      .attr('font-size', 11).attr('fill', INK_MUTED).text((value) => value));

  // Eje X: D0, D1... con saltos si no caben todas las etiquetas.
  const step = Math.max(1, Math.ceil((lastDay + 1) / Math.max(Math.floor(innerWidth / 36), 1)));
  const xTicks = Array.from({ length: lastDay + 1 }, (_, day) => day).filter((day) => day % step === 0);
  root.selectAll('g.x-axis').data([null]).join('g').attr('class', 'x-axis')
    .selectAll('text').data(xTicks, (day) => day).join('text')
    .attr('data-day', (day) => day)
    .attr('y', innerHeight + 18).attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', INK_MUTED)
    .text((day) => `D${day}`)
    .attr('x', (day) => x(day));

  // Umbral de riesgo (opcional).
  root.selectAll('line.threshold').data(threshold ? [threshold] : []).join('line')
    .attr('class', 'threshold')
    .attr('x2', innerWidth)
    .attr('stroke', (item) => item.color).attr('stroke-dasharray', '4 3').attr('stroke-width', 1.5)
    .attr('y1', (item) => y(item.value)).attr('y2', (item) => y(item.value));

  // Retícula del día activo (la mueve highlight()).
  root.selectAll('line.crosshair').data([null]).join('line')
    .attr('class', 'crosshair').attr('y2', innerHeight)
    .attr('stroke', INK_MUTED).attr('stroke-dasharray', '3 3').attr('visibility', 'hidden');

  const plot = root.selectAll('g.plot').data([null]).join('g')
    .attr('class', 'plot').attr('clip-path', `url(#${gradientId}-clip)`);

  const lineOf = line().x((point) => x(point.day)).y((point) => y(point.value)).curve(curveMonotoneX);
  const areaOf = area().x((point) => x(point.day)).y0(innerHeight).y1((point) => y(point.value)).curve(curveMonotoneX);

  plot.selectAll('path.area').data(lines.filter((item) => item.area && item.points.length > 1), (item) => item.key)
    .join((enter) => enter.append('path').attr('class', 'area').attr('d', (item) => areaOf(item.points)))
    .attr('fill', `url(#${gradientId}-area)`)
    .transition().duration(duration).ease(easeCubicOut)
    .attr('d', (item) => areaOf(item.points));

  plot.selectAll('path.series').data(lines.filter((item) => item.points.length), (item) => item.key)
    .join((enter) => enter.append('path').attr('class', 'series').attr('d', (item) => lineOf(item.points)))
    .attr('data-key', (item) => item.key)
    .attr('fill', 'none')
    .attr('stroke', (item) => item.color)
    .attr('stroke-width', (item) => item.width ?? 2)
    .attr('stroke-dasharray', (item) => (item.dashed ? '5 4' : null))
    .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
    .transition().duration(duration).ease(easeCubicOut)
    .attr('d', (item) => lineOf(item.points));

  // Puntos: entran creciendo, se desplazan al cambiar los datos y salen encogiéndose.
  plot.selectAll('g.dots').data(lines.filter((item) => item.dots), (item) => item.key)
    .join('g').attr('class', 'dots').attr('data-key', (item) => item.key)
    .selectAll('circle').data((item) => item.points.map((point) => ({ ...point, line: item })), (point) => point.day)
    .join(
      (enter) => enter.append('circle').attr('r', 0).attr('cx', (point) => x(point.day)).attr('cy', (point) => y(point.value)),
      (update) => update,
      (exit) => exit.transition().duration(duration).attr('r', 0).remove(),
    )
    .attr('data-day', (point) => point.day)
    .attr('fill', (point) => point.fill ?? point.line.color)
    .attr('stroke', '#ffffff').attr('stroke-width', 2)
    .transition().duration(duration).ease(easeCubicOut)
    .attr('cx', (point) => x(point.day)).attr('cy', (point) => y(point.value))
    .attr('r', (point) => point.line.dotRadius ?? 4.5);

  // Etiquetas al final de cada línea (sustituyen a la leyenda junto a los datos).
  const labels = spreadLabels(lines.filter((item) => item.endLabel && item.points.length).map((item) => {
    const last = item.points[item.points.length - 1];
    return { key: item.key, text: item.endLabel, color: item.endLabelColor ?? item.color, x: x(last.day) + 10, y: y(last.value) };
  }));
  plot.selectAll('text.end-label').data(labels, (item) => item.key)
    // Nacen en su sitio: la transición solo las desplaza cuando cambian los datos.
    .join((enter) => enter.append('text').attr('x', (item) => item.x).attr('y', (item) => item.y))
    .attr('class', 'end-label').attr('dy', '0.32em').attr('font-size', 11).attr('font-weight', 600)
    .attr('fill', (item) => item.color).text((item) => item.text)
    .transition().duration(duration).attr('x', (item) => item.x).attr('y', (item) => item.y);

  // Entrada de izquierda a derecha, una sola vez.
  clipRect.interrupt();
  if (animate && !reducedMotion) {
    clipRect.attr('width', 0).transition().duration(ENTER_MS).ease(easeCubicOut).attr('width', innerWidth + 16 + margin.right);
  } else {
    clipRect.attr('width', innerWidth + 16 + margin.right);
  }

  // Zona de captura más grande que las marcas: todo el área de datos.
  const days = [...new Set(lines.flatMap((item) => item.points.map((point) => point.day)))].sort((a, b) => a - b);
  const nearest = (pixel) => {
    const target = x.invert(pixel);
    return days.reduce((best, day) => (Math.abs(day - target) < Math.abs(best - target) ? day : best), days[0]);
  };
  root.selectAll('rect.capture').data([null]).join('rect')
    .attr('class', 'capture').attr('width', innerWidth).attr('height', innerHeight).attr('fill', 'transparent')
    .on('pointermove pointerdown', (event) => { if (days.length) onActivate?.(nearest(pointer(event)[0])); })
    .on('pointerleave', () => onLeave?.())
    .raise();

  return { x, y, innerHeight, days };
}

// Resalta el día activo: retícula, día del eje en negrita y punto ampliado.
export function highlightDay(svgNode, geometry, day) {
  if (!svgNode || !geometry) return;
  const svg = select(svgNode);
  const active = day !== null && day !== undefined;
  svg.select('line.crosshair')
    .attr('visibility', active ? 'visible' : 'hidden')
    .attr('x1', active ? geometry.x(day) : 0).attr('x2', active ? geometry.x(day) : 0);
  svg.selectAll('g.x-axis text').attr('font-weight', (value) => (value === day ? 700 : 400));
  svg.selectAll('g.dots circle').classed('is-active', (point) => point.day === day)
    .interrupt('highlight')
    .transition('highlight').duration(150)
    .attr('r', (point) => (point.day === day ? 7 : (point.line.dotRadius ?? 4.5)));
}

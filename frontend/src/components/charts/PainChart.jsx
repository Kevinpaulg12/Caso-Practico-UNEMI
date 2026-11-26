// EVA por día de seguimiento (día 0 = la última intervención): lo reportado frente a la curva esperada del procedimiento.
// D3 dibuja y anima el SVG; React aporta la leyenda, el tooltip, el teclado y la tabla equivalente.
import { useEffect, useId, useRef, useState } from 'react';
import { ALERT_LABELS } from '../alertLevels';
import ChartTooltipBox from './ChartTooltipBox';
import { MARGIN, highlightDay, renderLineChart } from './lineChart';
import { PainLegend, PainTable, PainTooltipContent } from './PainChartParts';
import useChartWidth, { prefersReducedMotion } from './useChartWidth';
import { EXPECTED, INK, INK_MUTED, LEVEL_FILL, REPORTED } from './chartTheme';

const TOOLTIP_WIDTH = 170;

// `series` sale de buildSeries(); con showReported={false} solo se dibuja la curva esperada.
export default function PainChart({
  series,
  showReported = true,
  reportedLabel = 'Reportado (máx. del día)',
  expectedLabel = 'Esperado para el procedimiento',
  ariaLabel,
  height = 240,
}) {
  const boxRef = useRef(null);
  const svgRef = useRef(null);
  const geometry = useRef(null);
  const drawn = useRef(false);
  const width = useChartWidth(boxRef);
  const [activeDay, setActiveDay] = useState(null);
  const chartId = `eva-${useId().replace(/:/g, '')}`;

  const reported = showReported ? series.filter((point) => point.reported !== null) : [];
  const expected = series.filter((point) => point.expected !== null);
  const showExpected = expected.length > 0;
  // Sin niveles de alerta (la vista del paciente) no hay leyenda ni columna de colores.
  const showLevels = reported.some((point) => point.color);
  const both = showReported && showExpected;
  const lastDay = series.length ? series[series.length - 1].day : 0;
  // Los datos cambian de identidad en cada render del padre: se redibuja solo si cambian de verdad.
  const dataKey = JSON.stringify([series, showReported]);

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
      lines: [
        {
          key: 'expected', color: EXPECTED, dashed: true, endLabel: both ? 'Esperado' : null, endLabelColor: INK_MUTED,
          dots: !showReported, dotRadius: 4,
          points: expected.map((point) => ({ day: point.day, value: point.expected })),
        },
        {
          key: 'reported', color: REPORTED, width: 2.5, area: true, dots: true, endLabel: both ? 'Reportado' : null, endLabelColor: INK,
          points: reported.map((point) => ({ day: point.day, value: point.reported, fill: LEVEL_FILL[point.color] ?? REPORTED })),
        },
      ],
    });
    drawn.current = true;
    highlightDay(svgRef.current, geometry.current, activeDay);
    // activeDay se aplica en el efecto siguiente; aquí solo se redibuja por tamaño o datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, dataKey, chartId]);

  useEffect(() => {
    highlightDay(svgRef.current, geometry.current, activeDay);
  }, [activeDay]);

  const point = activeDay === null ? null : series.find((item) => item.day === activeDay);
  const days = series
    .filter((item) => (showReported && item.reported !== null) || item.expected !== null)
    .map((item) => item.day);

  const onKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !days.length) return;
    event.preventDefault();
    const index = days.indexOf(activeDay);
    const next = {
      ArrowRight: index < 0 ? 0 : Math.min(index + 1, days.length - 1),
      ArrowLeft: index < 0 ? days.length - 1 : Math.max(index - 1, 0),
      Home: 0,
      End: days.length - 1,
    }[event.key];
    setActiveDay(days[next]);
  };

  const pointX = point && geometry.current ? MARGIN.left + geometry.current.x(point.day) : 0;
  const tooltipLeft = pointX + 12 + TOOLTIP_WIDTH <= width
    ? pointX + 12
    : pointX - 12 - TOOLTIP_WIDTH >= 0
      ? pointX - 12 - TOOLTIP_WIDTH
      : Math.min(Math.max(pointX - TOOLTIP_WIDTH / 2, 0), Math.max(width - TOOLTIP_WIDTH, 0));

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        {both && <PainLegend reportedLabel={reportedLabel} expectedLabel={expectedLabel} />}
        {showLevels && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600" aria-hidden="true">
            <span>Punto:</span>
            {Object.entries(LEVEL_FILL).map(([level, fill]) => (
              <span key={level} className="flex items-center gap-1">
                <svg width="8" height="8"><circle cx="4" cy="4" r="4" fill={fill} /></svg>
                {ALERT_LABELS[level]}
              </span>
            ))}
          </div>
        )}
      </div>

      <div ref={boxRef} className="relative mt-3 w-full" style={{ height }}>
        <svg
          ref={svgRef}
          role="img"
          aria-label={`${ariaLabel || 'Gráfica de EVA por día de seguimiento.'} Usa las flechas izquierda y derecha para recorrer los días.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActiveDay(null)}
          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        />
        {point && (
          <div className="pointer-events-none absolute z-10" style={{ left: tooltipLeft, top: MARGIN.top, width: TOOLTIP_WIDTH }}>
            <ChartTooltipBox title={`Día ${point.day}`}>
              <PainTooltipContent point={point} showReported={showReported} showLevels={showLevels} />
            </ChartTooltipBox>
          </div>
        )}
      </div>

      <PainTable series={series} showReported={showReported} showExpected={showExpected} showLevels={showLevels} />
    </div>
  );
}

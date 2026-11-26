// Piezas comunes de la gráfica de EVA, independientes de la librería que dibuja (Recharts o D3).
import { AlertDot } from '../AlertLevel';
import { ALERT_LABELS } from '../alertLevels';
import { EXPECTED, REPORTED } from './chartTheme';

function LegendLine({ color, dashed, children }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} /></svg>
      {children}
    </span>
  );
}

export function PainLegend({ reportedLabel, expectedLabel }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600" aria-hidden="true">
      <LegendLine color={REPORTED}>{reportedLabel}</LegendLine>
      <LegendLine color={EXPECTED} dashed>{expectedLabel}</LegendLine>
    </div>
  );
}

export function PainTooltipContent({ point, showReported, showLevels = true }) {
  return (
    <>
      {showReported && (point.reported !== null ? (
        <p className="mt-1 flex items-center gap-1.5">
          {showLevels && <AlertDot color={point.color} />}
          EVA máx. {point.reported}{showLevels ? ` · ${point.reports} ${point.reports === 1 ? 'reporte' : 'reportes'}` : ''}
        </p>
      ) : (
        <p className="mt-1 text-slate-500">Sin reportes</p>
      ))}
      {point.expected !== null && <p className="mt-0.5 text-slate-500">Esperado: EVA {point.expected}</p>}
    </>
  );
}

export function PainTable({ series, showReported, showExpected, showLevels = true }) {
  return (
    <details className="mt-3 text-xs text-slate-600">
      <summary className="cursor-pointer font-semibold text-blue-700">Ver datos en tabla</summary>
      <table className="mt-2 w-full text-left">
        <thead className="text-[10px] uppercase tracking-wider text-slate-400">
          <tr>
            <th scope="col" className="py-1">Día</th>
            {showReported && <th scope="col">EVA máx.</th>}
            {showExpected && <th scope="col">Esperado</th>}
            {showReported && showLevels && <th scope="col">Nivel</th>}
          </tr>
        </thead>
        <tbody>
          {series.filter((point) => (showReported && point.reported !== null) || point.expected !== null).map((point) => (
            <tr key={point.day} className="border-t border-slate-100">
              <td className="py-1">{point.day}</td>
              {showReported && <td>{point.reported ?? '—'}</td>}
              {showExpected && <td>{point.expected ?? '—'}</td>}
              {showReported && showLevels && <td>{point.color ? ALERT_LABELS[point.color] : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

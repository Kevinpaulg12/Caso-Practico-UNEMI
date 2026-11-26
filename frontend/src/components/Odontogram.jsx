// Odontograma interactivo en SVG con notación FDI: arcada superior e inferior vistas de frente
// (la derecha del paciente queda a la izquierda de la pantalla). Cada pieza se pulsa para marcarla.
import { toothName } from './odontogramNames';

const PERMANENT = {
  upper: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]],
  lower: [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
};
const PRIMARY = {
  upper: [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65]],
  lower: [[85, 84, 83, 82, 81], [71, 72, 73, 74, 75]],
};
// Ancho de la corona según el tipo de pieza (incisivos estrechos, molares anchos).
const WIDTH = { 1: 22, 2: 20, 3: 22, 4: 24, 5: 24, 6: 32, 7: 30, 8: 28 };
const PRIMARY_WIDTH = { 1: 20, 2: 18, 3: 20, 4: 26, 5: 30 };
const HEIGHT = { 1: 34, 2: 32, 3: 36, 4: 30, 5: 30, 6: 28, 7: 28, 8: 26 };
const PRIMARY_HEIGHT = { 1: 28, 2: 26, 3: 30, 4: 26, 5: 26 };
const GAP = 3;
const MIDLINE = 10;
const CURVE = 22;
const PAD = 12;

// Posición de cada pieza a lo largo de la arcada: un arco suave, más alto (o bajo) hacia los molares.
function layout(halves, primary) {
  const teeth = [...halves[0], ...halves[1]];
  const widths = teeth.map((tooth) => (primary ? PRIMARY_WIDTH : WIDTH)[tooth % 10]);
  const total = widths.reduce((sum, width) => sum + width, 0) + GAP * (teeth.length - 2) + MIDLINE;
  let x = PAD;
  return {
    width: total + PAD * 2,
    teeth: teeth.map((tooth, index) => {
      const width = widths[index];
      const item = { tooth, x, width, height: (primary ? PRIMARY_HEIGHT : HEIGHT)[tooth % 10] };
      const center = x + width / 2 - PAD - total / 2;
      item.offset = CURVE * (center / (total / 2)) ** 2;
      x += width + (index === halves[0].length - 1 ? MIDLINE : GAP);
      return item;
    }),
  };
}

// Corona con el borde de la raíz redondeado; los caninos terminan en punta.
function crownPath({ x, width, height, tooth }, top, pointsDown) {
  const canine = tooth % 10 === 3;
  const r = Math.min(8, width / 3);
  const bottom = top + height;
  if (pointsDown) {
    const tip = canine ? `L${x + width / 2},${bottom + 5} ` : '';
    return `M${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} `
      + `L${x + width},${bottom - 4} Q${x + width},${bottom} ${x + width - 4},${bottom} ${tip}L${x + 4},${bottom} Q${x},${bottom} ${x},${bottom - 4} Z`;
  }
  const tip = canine ? `L${x + width / 2},${top - 5} ` : '';
  return `M${x},${bottom - r} Q${x},${bottom} ${x + r},${bottom} L${x + width - r},${bottom} Q${x + width},${bottom} ${x + width},${bottom - r} `
    + `L${x + width},${top + 4} Q${x + width},${top} ${x + width - 4},${top} ${tip}L${x + 4},${top} Q${x},${top} ${x},${top + 4} Z`;
}

function Tooth({ item, top, upper, selected, readOnly, onToggle }) {
  const label = toothName(item.tooth);
  const path = crownPath(item, top, upper);
  const numberY = upper ? top - 6 : top + item.height + 14;
  const shape = (
    <>
      <path
        d={path}
        className={`transition-colors ${selected ? 'fill-blue-600 stroke-blue-800' : `fill-white stroke-slate-300 ${readOnly ? '' : 'group-hover:fill-blue-50 group-hover:stroke-blue-400'}`}`}
        strokeWidth="1.5"
      />
      <text x={item.x + item.width / 2} y={numberY} textAnchor="middle" className={`text-[10px] font-bold ${selected ? 'fill-blue-700' : 'fill-slate-500'}`}>
        {item.tooth}
      </text>
    </>
  );
  if (readOnly) {
    return <g aria-hidden="true">{shape}<title>{label}</title></g>;
  }
  return (
    <g
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      tabIndex={0}
      onClick={() => onToggle(item.tooth)}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          onToggle(item.tooth);
        }
      }}
      className="group cursor-pointer outline-none focus-visible:[&>path]:stroke-blue-600 focus-visible:[&>path]:[stroke-width:3]"
    >
      <title>{label}</title>
      {shape}
    </g>
  );
}

function Arch({ halves, primary, upper, selected, readOnly, onToggle, label }) {
  const { width, teeth } = layout(halves, primary);
  const tallest = Math.max(...teeth.map((item) => item.height));
  const height = tallest + CURVE + 34;
  return (
    <svg
      role={readOnly ? 'img' : 'group'}
      aria-label={readOnly ? `${label}: ${teeth.filter((item) => selected.includes(item.tooth)).map((item) => item.tooth).join(', ') || 'sin piezas marcadas'}` : label}
      viewBox={`0 0 ${width} ${height}`}
      className="mx-auto block h-auto w-full max-w-[640px]"
    >
      <line x1={width / 2} x2={width / 2} y1="4" y2={height - 4} className="stroke-slate-300" strokeDasharray="3 3" />
      {teeth.map((item) => {
        // Superior: los molares quedan más arriba; inferior: más abajo (forma de arcada).
        const top = upper ? 18 + CURVE - item.offset : 6 + item.offset;
        return (
          <Tooth key={item.tooth} item={item} top={top} upper={upper} selected={selected.includes(item.tooth)} readOnly={readOnly} onToggle={onToggle} />
        );
      })}
    </svg>
  );
}

export default function Odontogram({ value = [], onChange, readOnly = false, dentition = 'permanent', onDentitionChange }) {
  const primary = dentition === 'primary';
  const charts = primary ? PRIMARY : PERMANENT;
  const toggle = (tooth) => {
    const next = value.includes(tooth) ? value.filter((item) => item !== tooth) : [...value, tooth];
    onChange?.(next.sort((a, b) => a - b));
  };
  const selectedNames = value.map(toothName);
  const shared = { primary, selected: value, readOnly, onToggle: toggle };

  return (
    <div className="min-w-0">
      {!readOnly && onDentitionChange && (
        <div role="group" aria-label="Dentición" className="mb-2 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-semibold">
          {[['permanent', 'Permanente'], ['primary', 'Temporal (niños)']].map(([option, label]) => (
            <button
              key={option}
              type="button"
              aria-pressed={dentition === option}
              onClick={() => onDentitionChange(option)}
              className={`rounded-md px-2.5 py-1 ${dentition === option ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <figure className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <figcaption className="sr-only">Odontograma: arcada superior e inferior vistas de frente; la derecha del paciente está a la izquierda.</figcaption>
        <p aria-hidden="true" className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <span>Derecha</span><span>Superior</span><span>Izquierda</span>
        </p>
        <Arch {...shared} halves={charts.upper} upper label="Arcada superior" />
        <Arch {...shared} halves={charts.lower} upper={false} label="Arcada inferior" />
        <p aria-hidden="true" className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Inferior</p>
      </figure>
      <p className="mt-1.5 text-[11px] text-slate-500" aria-live="polite">
        {value.length ? `Piezas: ${selectedNames.join('; ')}` : readOnly ? 'Sin piezas registradas.' : 'Ninguna pieza seleccionada (opcional para tratamientos de toda la boca).'}
      </p>
    </div>
  );
}

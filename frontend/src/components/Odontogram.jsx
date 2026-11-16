// Odontograma simple en notación FDI: arcada superior e inferior vistas de frente
// (la derecha del paciente queda a la izquierda de la pantalla).
const PERMANENT = {
  upper: [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]],
  lower: [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]],
};
const PRIMARY = {
  upper: [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65]],
  lower: [[85, 84, 83, 82, 81], [71, 72, 73, 74, 75]],
};
const TOOTH_NAMES = { 1: 'incisivo central', 2: 'incisivo lateral', 3: 'canino', 4: 'primer premolar', 5: 'segundo premolar', 6: 'primer molar', 7: 'segundo molar', 8: 'tercer molar' };
const PRIMARY_NAMES = { 1: 'incisivo central temporal', 2: 'incisivo lateral temporal', 3: 'canino temporal', 4: 'primer molar temporal', 5: 'segundo molar temporal' };
const QUADRANTS = { 1: 'superior derecho', 2: 'superior izquierdo', 3: 'inferior izquierdo', 4: 'inferior derecho', 5: 'superior derecho', 6: 'superior izquierdo', 7: 'inferior izquierdo', 8: 'inferior derecho' };

export function toothName(number) {
  const quadrant = Math.floor(number / 10);
  const position = number % 10;
  const name = quadrant >= 5 ? PRIMARY_NAMES[position] : TOOTH_NAMES[position];
  return `${number}: ${name} ${QUADRANTS[quadrant]}`;
}

function Arch({ halves, selected, onToggle, readOnly, label }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap justify-center gap-x-3 gap-y-1">
      {halves.map((half, index) => (
        <div key={index} className={`flex gap-0.5 ${index === 0 ? 'sm:border-r sm:border-dashed sm:border-slate-300 sm:pr-3' : ''}`}>
          {half.map((tooth) => {
            const isSelected = selected.includes(tooth);
            const common = 'flex h-8 w-7 items-center justify-center rounded-md border text-[11px] font-bold sm:h-9 sm:w-8';
            if (readOnly) {
              return (
                <span
                  key={tooth}
                  title={toothName(tooth)}
                  className={`${common} ${isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-300'}`}
                >
                  {tooth}
                </span>
              );
            }
            return (
              <button
                key={tooth}
                type="button"
                aria-pressed={isSelected}
                aria-label={toothName(tooth)}
                title={toothName(tooth)}
                onClick={() => onToggle(tooth)}
                className={`${common} transition ${isSelected ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:bg-blue-50'}`}
              >
                {tooth}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function Odontogram({ value = [], onChange, readOnly = false, dentition = 'permanent', onDentitionChange }) {
  const charts = dentition === 'primary' ? PRIMARY : PERMANENT;
  const toggle = (tooth) => {
    const next = value.includes(tooth) ? value.filter((item) => item !== tooth) : [...value, tooth];
    onChange?.(next.sort((a, b) => a - b));
  };
  const selectedNames = value.map(toothName);

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
      <div className="space-y-2 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Superior</p>
        <Arch halves={charts.upper} selected={value} onToggle={toggle} readOnly={readOnly} label="Arcada superior" />
        <div className="border-t border-slate-200" />
        <Arch halves={charts.lower} selected={value} onToggle={toggle} readOnly={readOnly} label="Arcada inferior" />
        <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Inferior</p>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500" aria-live="polite">
        {value.length ? `Piezas: ${selectedNames.join('; ')}` : readOnly ? 'Sin piezas registradas.' : 'Ninguna pieza seleccionada (opcional para tratamientos de toda la boca).'}
      </p>
    </div>
  );
}

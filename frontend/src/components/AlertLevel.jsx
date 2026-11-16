const DOT = { rojo: 'bg-rose-600', amarillo: 'bg-amber-500', verde: 'bg-emerald-600' };

export function AlertDot({ color }) {
  return <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[color] ?? 'bg-slate-300'}`} />;
}

export function SymptomChips({ entities }) {
  const symptoms = (entities || []).filter((item) => item.label === 'SINTOMA');
  if (!symptoms.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {symptoms.map((item, index) => (
        <span
          key={`${item.category}-${index}`}
          className={`rounded-md border px-2 py-0.5 text-[10px] ${item.negated ? 'border-slate-200 bg-white text-slate-400 line-through' : 'border-blue-100 bg-blue-50 text-blue-800'}`}
        >
          {item.category}{item.intensity ? ` (${item.intensity})` : ''}{item.negated ? ' · negado' : ''}
        </span>
      ))}
    </div>
  );
}

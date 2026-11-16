export default function ChartTooltipBox({ title, children }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg">
      <p className="font-bold text-slate-900">{title}</p>
      {children}
    </div>
  );
}

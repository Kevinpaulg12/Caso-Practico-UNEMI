import { useEffect, useState } from 'react';
import DoctorLayout from '../components/DoctorLayout';
import { IconSearch } from '../components/Icons';
import api from '../services/api';

const formatDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('es-EC');

export default function Discharges() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      api.get('/discharges/', { params: { search: search.trim() || undefined } })
        .then(({ data }) => {
          if (stale) return;
          setItems(data);
          setError('');
        })
        .catch(() => {
          if (!stale) setError('No se pudo cargar el historial.');
        })
        .finally(() => {
          if (!stale) setLoading(false);
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search]);

  const averageDays = items.length
    ? (items.reduce((sum, item) => sum + item.followup_days, 0) / items.length).toFixed(1)
    : '—';

  return (
    <DoctorLayout
      title="Historial y altas"
      subtitle="Tratamientos cerrados de tus pacientes. Da de alta desde la ficha en Pacientes Activos."
    >
      <dl className="mb-6 grid gap-4 md:grid-cols-2">
        <Summary title="Tratamientos cerrados" value={items.length} />
        <Summary title="Días promedio de seguimiento" value={averageDays} />
      </dl>

      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
            <IconSearch className="h-4 w-4" />
          </span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por paciente o procedimiento..."
            aria-label="Buscar en el historial"
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
          />
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th scope="col" className="p-3">Paciente</th>
                <th scope="col" className="p-3">Procedimiento</th>
                <th scope="col" className="p-3">Inicio y alta</th>
                <th scope="col" className="p-3">Días de seguimiento</th>
                <th scope="col" className="p-3">Alertas de riesgo alto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3">
                    <strong className="block text-slate-900">{item.patient_name}</strong>
                    <span className="text-[11px] text-slate-400">HC-{String(item.patient_id).padStart(5, '0')}</span>
                  </td>
                  <td className="p-3 font-medium text-slate-800">{item.procedure}</td>
                  <td className="p-3 text-slate-600">
                    <span className="text-[11px]">Inicio: {formatDate(item.start_date)}</span>
                    <strong className="block text-slate-800">Alta: {formatDate(item.discharged_at)}</strong>
                  </td>
                  <td className="p-3">{item.followup_days}</td>
                  <td className="p-3">
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${item.high_alerts ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                      {item.high_alerts || 'Ninguna'}
                    </span>
                  </td>
                </tr>
              ))}
              {!items.length && !loading && (
                <tr><td colSpan="5" className="p-6 text-center text-slate-500">Aún no hay tratamientos cerrados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DoctorLayout>
  );
}

function Summary({ title, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</dt>
      <dd className="mt-2 text-2xl font-black text-slate-900">{value}</dd>
    </div>
  );
}

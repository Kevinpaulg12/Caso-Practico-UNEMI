import { useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import { IconSearch, IconShield } from '../components/Icons';
import api from '../services/api';

export default function AuditLog() {
  const [events, setEvents] = useState([]);
  const [count, setCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [days, setDays] = useState('7');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      api.get('/audit-events/', { params: { search: search.trim() || undefined, days, page } })
        .then(({ data }) => {
          if (stale) return;
          setEvents(data.results);
          setCount(data.count);
          setHasNext(Boolean(data.next));
          setError('');
        })
        .catch(() => {
          if (!stale) setError('No se pudo cargar el registro de auditoría.');
        })
        .finally(() => {
          if (!stale) setLoading(false);
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [search, days, page]);

  return (
    <AdminLayout
      title="Registro de auditoría"
      subtitle="Accesos y cambios registrados por el sistema."
    >
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <IconSearch className="h-4 w-4" />
            </span>
            <input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Buscar por usuario o acción..."
              aria-label="Buscar eventos"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2 pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-blue-500 focus:bg-white"
            />
          </div>
          <select
            value={days}
            onChange={(event) => { setDays(event.target.value); setPage(1); }}
            aria-label="Periodo"
            className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-700 outline-none"
          >
            <option value="7">Últimos 7 días</option>
            <option value="30">Últimos 30 días</option>
            <option value="365">Último año</option>
          </select>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th scope="col" className="p-3">Fecha y hora</th>
                <th scope="col" className="p-3">Usuario / Actor</th>
                <th scope="col" className="p-3">Acción realizada</th>
                <th scope="col" className="p-3">Módulo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((event) => (
                <tr key={event.id} className={event.module === 'Seguridad' && event.action.includes('denegado') ? 'bg-rose-50/70' : ''}>
                  <td className="p-3 font-mono text-[11px] text-slate-500">{new Date(event.created_at).toLocaleString('es-EC')}</td>
                  <td className="p-3 font-semibold text-slate-800">{event.actor_label}</td>
                  <td className="p-3 text-slate-700">{event.action}</td>
                  <td className="p-3">
                    <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[10px] font-bold text-blue-700">{event.module}</span>
                  </td>
                </tr>
              ))}
              {!events.length && !loading && (
                <tr><td colSpan="4" className="p-6 text-center text-slate-500">No hay eventos en este periodo.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <span>{count} {count === 1 ? 'evento' : 'eventos'}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">Anterior</button>
            <button type="button" disabled={!hasNext} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-40">Siguiente</button>
          </div>
        </div>
      </section>

      <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
        <IconShield className="h-4 w-4 text-slate-400" />
        <span>Vista de solo lectura.</span>
      </div>
    </AdminLayout>
  );
}

import { Suspense, lazy, useEffect, useState } from 'react';
import api from '../../services/api';
import ChartLoading from '../charts/ChartLoading';
import { IconCheckCircle } from '../Icons';

const AdherenceChart = lazy(() => import('../charts/AdherenceChart'));

// Checklist diario: el paciente marca lo que cumplió; mide la adherencia al tratamiento.
export default function CareChecklist({ canReport }) {
  const [state, setState] = useState({ status: 'loading', items: [], history: [], adherence: null });
  const [marks, setMarks] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/care-checkins/')
      .then(({ data }) => {
        setState({ status: 'ready', items: data.items, history: data.history, adherence: data.adherence_7_days });
        setMarks(data.today?.items ?? Object.fromEntries(data.items.map((item) => [item, false])));
      })
      .catch(() => setState((current) => ({ ...current, status: 'error' })));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data } = await api.post('/care-checkins/', { items: marks });
      const history = [data, ...state.history.filter((item) => item.date !== data.date)];
      setState((current) => ({ ...current, history }));
      setMessage(`Guardado: cumpliste el ${data.adherence} % de tus cuidados de hoy.`);
    } catch (requestError) {
      setError(requestError.response?.data?.items?.[0] || requestError.response?.data?.detail || 'No se pudo guardar. Inténtalo nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  if (state.status === 'loading') return <p className="rounded-2xl border border-slate-200 bg-white p-5 text-xs text-slate-500">Cargando tus cuidados...</p>;
  if (state.status === 'error') return <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-xs text-rose-700">No se pudieron cargar tus cuidados.</p>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6">
        <h2 className="text-sm font-bold text-slate-900">Mis cuidados de hoy</h2>
        <p className="text-xs text-slate-500">Marca lo que ya hiciste. Tu odontólogo ve cuánto cumples tus indicaciones.</p>
        {!canReport || state.items.length === 0 ? (
          <p className="mt-4 rounded-xl bg-slate-50 py-6 text-center text-xs text-slate-400">Tu tratamiento no tiene una lista de cuidados diarios.</p>
        ) : (
          <form onSubmit={save} className="mt-4 space-y-2">
            <fieldset className="min-w-0 space-y-2">
              <legend className="sr-only">Cuidados del día</legend>
              {state.items.map((item) => (
                <label key={item} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${marks[item] ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={Boolean(marks[item])} onChange={(event) => setMarks((current) => ({ ...current, [item]: event.target.checked }))} className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-600" />
                  <span>{item}</span>
                </label>
              ))}
            </fieldset>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
              <IconCheckCircle className="h-4 w-4" /> {saving ? 'Guardando...' : 'Guardar mis cuidados de hoy'}
            </button>
            {message && <p role="status" className="text-xs font-semibold text-emerald-700">{message}</p>}
            {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
          </form>
        )}
      </section>
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6">
        <h2 className="text-sm font-bold text-slate-900">Cumplimiento de los últimos días</h2>
        <p className="text-xs text-slate-500">
          {state.adherence != null ? `Promedio de los últimos 7 días: ${state.adherence} %` : 'Aún no registras tus cuidados.'}
        </p>
        <Suspense fallback={<ChartLoading />}>
          <AdherenceChart checkins={state.history} />
        </Suspense>
      </section>
    </div>
  );
}

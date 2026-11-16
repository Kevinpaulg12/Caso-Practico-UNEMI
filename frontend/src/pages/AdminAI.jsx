import { useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import api from '../services/api';

const number = (value) => new Intl.NumberFormat('es-EC').format(value ?? 0);

// Uso de la IA en los últimos 30 días: evidencia de latencia, consumo y fiabilidad.
export default function AdminAI() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/ai/metrics/').then(({ data: metrics }) => setData(metrics)).catch(() => setError('No se pudieron cargar las métricas.'));
  }, []);

  const totals = (data?.features ?? []).reduce((sum, row) => ({
    total: sum.total + row.total,
    llm: sum.llm + row.llm,
    input: sum.input + row.input_tokens,
    cached: sum.cached + row.cache_read_tokens,
  }), { total: 0, llm: 0, input: 0, cached: 0 });

  return (
    <AdminLayout title="Inteligencia artificial" subtitle="Cómo se usa el modelo de lenguaje y cuántas veces actuó la alternativa local.">
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {data && (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric title="Estado" value={data.enabled ? 'Activa' : 'Desactivada'} detail={data.enabled ? data.model : 'Se usan las alternativas locales'} />
            <Metric title="Usos en 30 días" value={number(totals.total)} detail={`${number(totals.llm)} resueltos por el modelo`} />
            <Metric
              title="Alternativa local"
              value={totals.total ? `${Math.round(100 * (totals.total - totals.llm) / totals.total)} %` : '—'}
              detail="IA desactivada, sin conexión, tiempo agotado o rechazo"
            />
            <Metric
              title="Tokens desde caché"
              value={totals.input + totals.cached ? `${Math.round(100 * totals.cached / (totals.input + totals.cached))} %` : '—'}
              detail="El prompt de sistema con los protocolos se reutiliza"
            />
          </section>

          <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">Uso por función</h2>
            {data.features.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">Aún no hay usos registrados.</p>
            ) : (
              <table className="mt-3 w-full min-w-[560px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                  <tr><th scope="col" className="py-2">Función</th><th scope="col">Usos</th><th scope="col">Con el modelo</th><th scope="col">Alternativa local</th><th scope="col">Latencia media</th><th scope="col">Tokens entrada / salida</th></tr>
                </thead>
                <tbody>
                  {data.features.map((row) => (
                    <tr key={row.feature} className="border-t border-slate-100 text-slate-700">
                      <td className="py-2 font-semibold">{row.label}</td>
                      <td>{number(row.total)}</td>
                      <td>{number(row.llm)}</td>
                      <td>{row.fallback_rate} %</td>
                      <td>{row.avg_latency_ms != null ? `${number(row.avg_latency_ms)} ms` : '—'}</td>
                      <td>{number(row.input_tokens)} / {number(row.output_tokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {data.errors.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Motivos de la alternativa local</h2>
              <ul className="mt-2 space-y-1 text-xs text-slate-700">
                {data.errors.map((item) => <li key={item.error}>{item.error}: <strong>{item.total}</strong></li>)}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-xs text-blue-900">
            <strong>Principios de la IA en DentalSense.</strong> El nivel de alerta siempre lo calcula el motor local de PLN y reglas
            (explicable y validado por el equipo clínico). El modelo de lenguaje solo conversa, resume y explica; recibe datos
            anonimizados y, si no está disponible, cada función usa su alternativa local.
          </section>
        </div>
      )}
    </AdminLayout>
  );
}

function Metric({ title, value, detail }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-black text-slate-900 [overflow-wrap:anywhere]">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

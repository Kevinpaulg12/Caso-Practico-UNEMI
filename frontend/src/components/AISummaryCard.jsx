import { useEffect, useState } from 'react';
import api from '../services/api';
import { fetchAll } from '../services/pagination';
import { currentPlan } from '../services/plans';
import { IconSparkles } from './Icons';

// Resumen clínico de la evolución: lo redacta la IA (o el sistema, si no está disponible).
export default function AISummaryCard({ patientId }) {
  const [plan, setPlan] = useState(null);
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('loading');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let stale = false;
    fetchAll('/treatment-plans/', { patient: patientId })
      .then(async (plans) => {
        const active = currentPlan(plans);
        if (stale) return;
        setPlan(active);
        if (!active) {
          setStatus('ready');
          return;
        }
        const { data } = await api.get(`/treatment-plans/${active.id}/summary/`);
        if (!stale) {
          setSummary(data);
          setStatus('ready');
        }
      })
      .catch(() => { if (!stale) setStatus('error'); });
    return () => { stale = true; };
  }, [patientId]);

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      const { data } = await api.post(`/treatment-plans/${plan.id}/summary/`);
      setSummary(data);
    } catch (requestError) {
      setError(requestError.response?.status === 429
        ? 'Alcanzaste el límite de resúmenes por hora. Inténtalo más tarde.'
        : 'No se pudo generar el resumen.');
    } finally {
      setGenerating(false);
    }
  };

  if (status === 'loading' || (status === 'ready' && !plan)) return null;
  const content = summary?.content;

  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white"><IconSparkles className="h-4 w-4" /></span>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Resumen clínico</h3>
            <p className="text-[11px] text-slate-500">
              {summary
                ? `${summary.source === 'llm' ? `Redactado por IA (${summary.model})` : 'Resumen automático del sistema'} · ${new Date(summary.created_at).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' })} · ${summary.reports_included} reportes`
                : 'Aún no se ha generado un resumen de este tratamiento.'}
            </p>
          </div>
        </div>
        <button type="button" onClick={generate} disabled={generating || status === 'error'} className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50">
          <IconSparkles className="h-3.5 w-3.5 shrink-0" />{generating ? 'Generando...' : summary ? 'Actualizar resumen' : 'Generar resumen'}
        </button>
      </div>
      {status === 'error' && <p role="alert" className="mt-3 text-xs text-rose-700">No se pudo cargar el resumen.</p>}
      {error && <p role="alert" className="mt-3 text-xs text-rose-700">{error}</p>}
      {content && (
        <div className="mt-3 space-y-2 text-xs text-slate-700">
          <p className="text-sm leading-relaxed text-slate-800">{content.resumen}</p>
          <Section title="Cambios recientes" items={content.cambios_recientes} />
          <Section title="Alertas" items={content.alertas} tone="rose" />
          {content.adherencia && <p><strong>Adherencia:</strong> {content.adherencia}</p>}
          <Section title="Para revisar en la próxima cita" items={content.puntos_a_revisar} />
          <p className="text-[10px] text-slate-400">{content.aviso}</p>
        </div>
      )}
    </section>
  );
}

function Section({ title, items, tone = 'slate' }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className={`text-[10px] font-bold uppercase tracking-wider ${tone === 'rose' ? 'text-rose-600' : 'text-slate-400'}`}>{title}</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

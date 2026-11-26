import { useState } from 'react';
import api from '../../services/api';
import { IconSend, IconSparkles } from '../Icons';

// Las indicaciones del odontólogo explicadas en lenguaje sencillo y preguntas sobre ellas.
export default function PlainInstructions({ planId }) {
  const [explanation, setExplanation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/treatment-plans/${planId}/explanation/`);
      setExplanation(data);
    } catch {
      setError('No se pudo preparar la explicación. Inténtalo más tarde.');
    } finally {
      setLoading(false);
    }
  };

  const ask = async (event) => {
    event.preventDefault();
    const value = question.trim();
    if (value.length < 3) return;
    setAsking(true);
    setError('');
    try {
      const { data } = await api.post(`/treatment-plans/${planId}/ask/`, { question: value });
      setAnswers((current) => [...current, { question: value, ...data }]);
      setQuestion('');
    } catch (requestError) {
      setError(requestError.response?.data?.question?.[0] || 'No se pudo responder tu pregunta.');
    } finally {
      setAsking(false);
    }
  };

  const content = explanation?.content;
  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white"><IconSparkles className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Tus indicaciones, explicadas</h2>
            <p className="text-[11px] text-slate-500">En palabras sencillas y solo con lo que indicó tu odontólogo.</p>
          </div>
        </div>
        {!content && (
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            <IconSparkles className="h-3.5 w-3.5 shrink-0" />{loading ? 'Preparando...' : 'Explícamelo fácil'}
          </button>
        )}
      </div>

      {content && (
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <p>{content.resumen}</p>
          <List title="Qué hacer" items={content.pasos} />
          <List title="Qué evitar" items={content.que_evitar} />
          {content.medicacion?.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Tu medicación</h3>
              <ul className="mt-1 space-y-1">
                {content.medicacion.map((item) => (
                  <li key={item.nombre} className="rounded-lg bg-slate-50 px-3 py-2">
                    <strong>{item.nombre}</strong>: {item.como_tomarlo}{item.para_que_sirve ? ` (${item.para_que_sirve})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <List title="Llama a la clínica si" items={content.cuando_llamar} tone="rose" />
          <p className="text-[10px] text-slate-400">
            {explanation.source === 'llm' ? 'Explicación redactada con inteligencia artificial a partir de tus indicaciones.' : 'Resumen automático de tus indicaciones.'}
          </p>
        </div>
      )}

      <form onSubmit={ask} className="mt-4 flex gap-2">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={300}
          placeholder="Pregunta sobre tus indicaciones, p. ej. ¿puedo comer pan?"
          aria-label="Pregunta sobre tus indicaciones"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs outline-none focus:border-violet-500 focus:bg-white focus:ring-2 focus:ring-violet-100"
        />
        <button type="submit" disabled={asking || question.trim().length < 3} className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50">
          <IconSend className="h-3.5 w-3.5" /> {asking ? '...' : 'Preguntar'}
        </button>
      </form>
      {answers.length > 0 && (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {answers.map((item, index) => (
            <li key={index} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs">
              <p className="font-semibold text-slate-900">{item.question}</p>
              <p className={`mt-1 ${item.grounded ? 'text-slate-700' : 'text-amber-800'}`}>{item.answer}</p>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
    </section>
  );
}

function List({ title, items, tone = 'slate' }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3 className={`text-xs font-bold uppercase tracking-wider ${tone === 'rose' ? 'text-rose-600' : 'text-slate-500'}`}>{title}</h3>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

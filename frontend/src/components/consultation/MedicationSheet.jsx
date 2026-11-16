import { useState } from 'react';
import api from '../../services/api';

const SECTIONS = [
  ['indications', 'Para qué sirve'],
  ['mechanism', 'Cómo actúa'],
  ['common_effects', 'Efectos adversos frecuentes'],
  ['warning_signs', 'Señales de alarma'],
  ['what_to_do', 'Qué debe hacer el paciente'],
];

// Ficha del medicamento a partir del prospecto oficial. Se pide solo cuando el odontólogo la quiere ver.
export default function MedicationSheet({ name }) {
  const [state, setState] = useState({ status: 'idle', name: '', sheet: null });
  if (name.length < 3) return null;
  // La ficha mostrada es la del medicamento actual: al cambiarlo, se vuelve a pedir.
  const current = state.name === name ? state : { status: 'idle', sheet: null };

  const load = async () => {
    setState({ status: 'loading', name, sheet: null });
    try {
      const { data } = await api.get('/medications/sheet/', { params: { name } });
      setState({ status: 'ready', name, sheet: data });
    } catch (error) {
      setState({ status: error.response?.status === 404 ? 'missing' : 'error', name, sheet: null });
    }
  };

  if (current.status === 'idle') {
    return (
      <button type="button" onClick={load} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100">
        Ver ficha de {name}
      </button>
    );
  }
  if (current.status === 'loading') {
    return <p role="status" className="text-xs text-slate-500">Consultando el prospecto oficial de {name}...</p>;
  }
  if (current.status !== 'ready') {
    return (
      <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        {current.status === 'missing'
          ? `No hay una ficha oficial para «${name}». Revisa el principio activo o indícale tú los cuidados al paciente.`
          : 'No se pudo consultar la ficha del medicamento. Puedes continuar con la receta.'}
      </p>
    );
  }
  const { sheet } = current;
  return (
    <section aria-label={`Ficha de ${sheet.name}`} className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-slate-700">
      <h4 className="text-xs font-black text-slate-900">{sheet.name}</h4>
      <dl className="mt-2 space-y-2">
        {SECTIONS.filter(([key]) => sheet[key]).map(([key, label]) => (
          <div key={key}>
            <dt className="font-bold text-slate-900">{label}</dt>
            <dd className="mt-0.5 whitespace-pre-line">{sheet[key]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[10px] text-slate-500">{sheet.source_note} El paciente verá esta información junto a su receta.</p>
    </section>
  );
}

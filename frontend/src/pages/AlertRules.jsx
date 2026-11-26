import { useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import { IconAlertTriangle, IconSave } from '../components/Icons';
import api from '../services/api';

const THRESHOLDS = [
  ['high_pain', 'Riesgo alto: EVA igual o mayor a'],
  ['rising_pain', 'Riesgo alto si el dolor aumenta: EVA igual o mayor a'],
  ['medium_pain', 'Riesgo medio: EVA igual o mayor a'],
];

// Reglas de cirugía oral por día de seguimiento (día 0 = la intervención). Ver backend/medical_monitor/rules/cirugia.py.
const POSTOPERATIVE_RULES = [
  ['Sangrado leve', 'Días 0 y 1: esperado', 'Desde el día 2: amarilla', 'Abundante o que no para: roja'],
  ['Inflamación', 'Días 0 a 3: esperada', 'Desde el día 4: amarilla', 'Aumenta desde el día 4: roja'],
  ['Dolor que aumenta', 'Según umbrales EVA', '—', 'Desde el día 3 con EVA medio o más: roja'],
  ['Fiebre', '—', 'Cualquier día: amarilla', 'Con pus, mal olor o mal sabor: roja'],
  ['Pus, mal olor o mal sabor', '—', 'Cualquier día: amarilla', 'Con fiebre: roja'],
  ['Adormecimiento u hormigueo', 'Días 0 y 1: esperado', 'Desde el día 2: amarilla', '—'],
];

const SENTINELS = [
  'Sangrado abundante o hemorragia',
  'Dificultad para respirar o tragar',
  'Dificultad para abrir la boca (trismo)',
  'Fiebre alta o de 38 °C en adelante',
  'Cara, mejilla o cuello muy inflamados',
  'Dolor intenso, severo o insoportable',
];

export default function AlertRules() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/alert-settings/')
      .then(({ data }) => setSettings(data))
      .catch(() => setError('No se pudieron cargar las reglas.'));
  }, []);

  const change = (name, delta) => {
    setMessage('');
    setSettings((current) => ({ ...current, [name]: Math.min(10, Math.max(1, current[name] + delta)) }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { high_pain, rising_pain, medium_pain } = settings;
      const { data } = await api.patch('/alert-settings/', { high_pain, rising_pain, medium_pain });
      setSettings(data);
      setMessage('Umbrales guardados. Se aplican a los próximos reportes.');
    } catch (requestError) {
      const detail = requestError.response?.data;
      setError((detail && typeof detail === 'object' && Object.values(detail).flat().join(' ')) || 'No se pudieron guardar los umbrales.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout
      title="Reglas de alerta"
      subtitle="Umbrales con los que el sistema clasifica el riesgo de cada reporte."
    >
      {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
      {message && <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">{message}</p>}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <IconAlertTriangle className="h-4 w-4 text-rose-600" />
            Umbrales de dolor (EVA)
          </h2>
          {settings && (
            <div className="mt-5 space-y-4">
              {THRESHOLDS.map(([name, label]) => (
                <div key={name} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <span className="min-w-0 flex-1 basis-40 text-xs font-bold text-slate-700">{label}</span>
                  <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                    <button type="button" aria-label={`Bajar: ${label}`} onClick={() => change(name, -1)} className="px-3 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100">−</button>
                    <output className="w-10 text-center text-xs font-bold text-slate-900">{settings[name]}</output>
                    <button type="button" aria-label={`Subir: ${label}`} onClick={() => change(name, 1)} className="px-3 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100">+</button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 w-full rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-95 disabled:opacity-50"
              >
                <IconSave className="h-3.5 w-3.5 shrink-0" />{saving ? 'Guardando...' : 'Guardar umbrales'}
              </button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">Signos de alarma</h2>
          <p className="mt-1 text-xs text-slate-500">
            Siempre marcan riesgo alto, sea cual sea el nivel de dolor. No se pueden desactivar.
          </p>
          <ul className="mt-4 divide-y divide-slate-100 text-xs text-slate-700">
            {SENTINELS.map((symptom) => <li key={symptom} className="py-2.5">{symptom}</li>)}
          </ul>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Reglas de cirugía oral según el día de seguimiento</h2>
        <p className="mt-1 text-xs text-slate-500">Cada especialidad (endodoncia, ortodoncia, periodoncia, implantes, prótesis, operatoria) tiene sus propias reglas. Las ventanas de síntomas esperados y los signos de alarma de cada tratamiento se editan en el Catálogo clínico.</p>
        <p className="mt-1 text-xs text-slate-500">
          El sistema reconoce los síntomas del mensaje del paciente y los compara con lo esperable para el día de
          recuperación. Deben ser validadas por el equipo odontológico.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr><th scope="col" className="p-2">Síntoma</th><th scope="col" className="p-2">Verde</th><th scope="col" className="p-2">Amarilla</th><th scope="col" className="p-2">Roja</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {POSTOPERATIVE_RULES.map(([symptom, green, yellow, red]) => (
                <tr key={symptom}>
                  <td className="p-2 font-semibold">{symptom}</td><td className="p-2">{green}</td><td className="p-2">{yellow}</td><td className="p-2">{red}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}

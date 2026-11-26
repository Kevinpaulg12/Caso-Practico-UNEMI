import { IconAlertTriangle, IconClock, IconPill } from '../Icons';

/**
 * Mis cuidados: la medicación que recetó el odontólogo, cómo tomarla y sus posibles efectos
 * secundarios, con las señales que obligan a llamar a la clínica.
 */
export default function MyMedication({ prescriptions }) {
  const active = prescriptions.filter((item) => item.is_active);
  const past = prescriptions.filter((item) => !item.is_active);

  return (
    <section aria-labelledby="mi-medicacion" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <IconPill className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="mi-medicacion" className="text-sm font-bold text-slate-900">Mi medicación</h2>
          <p className="text-xs text-slate-500">Lo que te recetó tu odontólogo, cómo tomarlo y qué efectos puede darte.</p>
        </div>
      </header>

      {active.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 py-6 text-center text-xs text-slate-500">
          No tienes medicación recetada en este momento.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {active.map((prescription) => <MedicationItem key={prescription.id} prescription={prescription} />)}
        </ul>
      )}

      {past.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-bold text-slate-600">Medicación anterior ({past.length})</summary>
          <ul className="mt-3 space-y-4">
            {past.map((prescription) => <MedicationItem key={prescription.id} prescription={prescription} />)}
          </ul>
        </details>
      )}
    </section>
  );
}

function MedicationItem({ prescription }) {
  const guidance = prescription.medication_guidance;
  const name = prescription.medication_name || guidance?.name || 'Medicamento';
  const dose = [prescription.strength, prescription.frequency, prescription.duration].filter(Boolean);

  return (
    <li>
      <article aria-label={`Sobre ${name}`} className="rounded-xl border border-slate-200 p-4 [overflow-wrap:anywhere]">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900">{name}</h3>
            <p className="text-[11px] text-slate-500">Recetó: Dr(a). {prescription.doctor_name || 'tu odontólogo'}</p>
          </div>
          {dose.length > 0 && (
            <p className="flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-700">
              {dose.map((part) => <span key={part} className="rounded-full bg-slate-100 px-2 py-0.5">{part}</span>)}
            </p>
          )}
        </header>

        {!prescription.medication_name && prescription.details && (
          <p className="mt-2 whitespace-pre-line text-xs text-slate-700">{prescription.details}</p>
        )}

        {guidance ? (
          <div className="mt-3 grid gap-3 text-xs text-slate-700 sm:grid-cols-2">
            <dl className="space-y-2">
              {guidance.indications && <Item term="Para qué sirve">{guidance.indications}</Item>}
              {guidance.what_to_do && (
                <Item term={<><IconClock className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />Cómo tomarlo</>}>{guidance.what_to_do}</Item>
              )}
              {guidance.mechanism && <Item term="Cómo actúa">{guidance.mechanism}</Item>}
            </dl>
            <div className="space-y-2">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                <p className="font-bold">Posibles efectos secundarios</p>
                <p className="mt-0.5">{guidance.common_effects || 'Tu odontólogo no registró efectos para este medicamento.'}</p>
              </div>
              {guidance.warning_signs && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">
                  <p className="flex items-center gap-1.5 font-bold"><IconAlertTriangle className="h-3.5 w-3.5" />Llama a la clínica de inmediato si</p>
                  <p className="mt-0.5">{guidance.warning_signs}</p>
                </div>
              )}
            </div>
            {guidance.source_note && <p className="text-[10px] text-slate-500 sm:col-span-2">{guidance.source_note}</p>}
          </div>
        ) : (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500">
            Aún no hay información de efectos para este medicamento. Pregúntale a tu odontólogo si tienes dudas.
          </p>
        )}
      </article>
    </li>
  );
}

function Item({ term, children }) {
  return (
    <div>
      <dt className="font-bold text-blue-900">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { fetchAll } from '../../services/pagination';
import {
  INICIO,
  fieldsFor,
  flattenApiErrors,
  medicationListErrors,
  medicationsPayload,
  newMedication,
  nextControlDate,
  protocolPayload,
  today,
  validateMedications,
  validateNextControl,
  validateProtocolFields,
} from '../../services/consultationRules';
import { IconAlertTriangle, IconArrowRight, IconCheckCircle, IconHistory, IconPill } from '../Icons';
import Odontogram from '../Odontogram';
import MedicationList from './MedicationList';
import PresetTextField from './PresetTextField';
import ProtocolFields from './ProtocolFields';
import { CheckField, Field, NextControlField, TextField } from './fields';

// Nombres de la API que en el formulario tienen otro campo.
const API_FIELDS = { details: 'instructions', procedure: 'clinical_procedure', start_date: 'surgery_date' };

const EMPTY_FORM = {
  admission_reason: '',
  specialty: '',
  clinical_procedure: '',
  clinical_notes: '',
  instructions: '',
  side_effects: '',
  diet_instructions: '',
  next_control_in_days: '',
};

// El registro se divide en pestañas: el odontólogo solo llena lo que su tratamiento necesita.
const TABS = [
  ['procedimiento', '1. Procedimiento y odontograma'],
  ['medicacion', '2. Medicación (opcional)'],
  ['cuidados', '3. Cuidados y dieta'],
];
const TAB_FIELDS = {
  procedimiento: ['admission_reason', 'clinical_procedure', 'procedure', 'surgery_date', 'teeth', 'clinical_notes'],
  medicacion: ['medications', 'medication_name', 'active_ingredient', 'strength', 'dosage_form', 'frequency', 'duration', 'notes'],
  cuidados: ['instructions', 'side_effects', 'diet_instructions', 'next_control_in_days'],
};

function tabWithErrors(errors, clinicalErrors) {
  if (Object.keys(clinicalErrors).length) return 'procedimiento';
  return TABS.map(([id]) => id).find((id) => TAB_FIELDS[id].some((field) => errors[field])) ?? null;
}

// Inicio de un tratamiento: el formulario se adapta al tratamiento elegido (sus datos, si lleva receta
// y cuándo debe volver el paciente).
export default function ConsultationForm({ onPrescriptionAdded, onTreatmentAdded, patientId }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, surgery_date: today() });
  const [clinicalData, setClinicalData] = useState({});
  const [prescribes, setPrescribes] = useState(true);
  // Uno o más medicamentos por receta.
  const [medicationItems, setMedicationItems] = useState(() => [newMedication()]);
  const [medicationErrors, setMedicationErrors] = useState({ list: [], general: '' });
  const [teeth, setTeeth] = useState([]);
  const [dentition, setDentition] = useState('permanent');
  const [procedures, setProcedures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [clinicalErrors, setClinicalErrors] = useState({});
  const [tab, setTab] = useState('procedimiento');
  const tabRefs = useRef({});

  const openTab = (id, focus = false) => {
    setTab(id);
    if (focus) tabRefs.current[id]?.focus();
  };

  useEffect(() => {
    fetchAll('/procedures/')
      .then((items) => setProcedures(Array.isArray(items) ? items : []))
      .catch(() => setErrorMsg('No se pudo cargar el catálogo de procedimientos.'));
  }, []);

  const selectedProcedure = procedures.find((item) => String(item.id) === String(form.clinical_procedure));
  // Especialidades del catálogo, en el orden en que aparecen.
  const specialties = [...new Map(procedures.map((item) => [item.specialty, item.specialty_label])).entries()];
  const visibleProcedures = form.specialty ? procedures.filter((item) => item.specialty === form.specialty) : procedures;
  const protocolFields = fieldsFor(selectedProcedure, INICIO);
  const usesTeeth = selectedProcedure?.uses_teeth !== false;
  // Los demás bloques dependen de la intervención: no se llenan hasta conocer el motivo, el tratamiento y su fecha.
  const consultationReady = form.admission_reason.trim().length >= 5
    && Boolean(form.clinical_procedure)
    && Boolean(form.surgery_date) && form.surgery_date <= today();
  const treatmentName = selectedProcedure?.name?.toLowerCase() || 'la intervención';
  const returnDate = nextControlDate(form.surgery_date, form.next_control_in_days);

  const update = ({ target }) => {
    const { name, value } = target;
    setForm((current) => {
      const next = { ...current, [name]: name === 'next_control_in_days' ? value.replace(/\D/g, '').slice(0, 3) : value };
      // Al cambiar de especialidad, la intervención elegida debe pertenecer a ella.
      if (name === 'specialty' && value && !procedures.some((item) => String(item.id) === String(current.clinical_procedure) && item.specialty === value)) {
        next.clinical_procedure = '';
      }
      if (name === 'clinical_procedure') {
        const chosen = procedures.find((item) => String(item.id) === String(value));
        if (chosen) {
          next.specialty = chosen.specialty;
          // El protocolo propone cada cuántos días vuelve el paciente; el odontólogo puede cambiarlo.
          next.next_control_in_days = chosen.control_every_days != null ? String(chosen.control_every_days) : '';
        }
      }
      return next;
    });
    if (name === 'clinical_procedure') {
      const chosen = procedures.find((item) => String(item.id) === String(value));
      // Cada tratamiento tiene sus propios datos y su costumbre de receta.
      setClinicalData({});
      setClinicalErrors({});
      setPrescribes(chosen?.medication_default !== false);
      if (chosen?.specialty === 'odontopediatria') setDentition('primary');
    }
    setErrorMsg('');
    setFieldErrors((current) => ({ ...current, [name]: '' }));
  };

  const updateMedications = (items) => {
    setMedicationItems(items);
    setMedicationErrors({ list: [], general: '' });
    setFieldErrors((current) => ({ ...current, medications: '' }));
    setErrorMsg('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!patientId) return;
    const admissionReason = form.admission_reason.trim();
    const instructions = form.instructions.trim();
    const sideEffects = form.side_effects.trim();
    const clinicalNotes = form.clinical_notes.trim();
    const diet = form.diet_instructions.trim();
    const listErrors = prescribes ? validateMedications(medicationItems) : null;
    setMedicationErrors({ list: listErrors ?? [], general: '' });
    const errors = listErrors ? { medications: 'Revisa los medicamentos de la receta.' } : {};
    if (diet.length > 1000) errors.diet_instructions = 'No puede superar 1000 caracteres.';
    if (!form.clinical_procedure) errors.clinical_procedure = 'Selecciona el tratamiento o intervención.';
    if (!form.surgery_date || form.surgery_date > today()) errors.surgery_date = 'Indica una fecha de intervención que no sea futura.';
    if (admissionReason.length < 5 || admissionReason.length > 240) errors.admission_reason = 'Describe el motivo entre 5 y 240 caracteres.';
    if (instructions.length < 10 || instructions.length > 1000) errors.instructions = 'Escribe indicaciones entre 10 y 1000 caracteres.';
    if (sideEffects.length > 500) errors.side_effects = 'No puede superar 500 caracteres.';
    if (clinicalNotes.length > 1000) errors.clinical_notes = 'No puede superar 1000 caracteres.';
    const controlError = validateNextControl(form.next_control_in_days);
    if (controlError) errors.next_control_in_days = controlError;
    const protocolErrors = validateProtocolFields(protocolFields, clinicalData);
    setFieldErrors(errors);
    setClinicalErrors(protocolErrors);
    if (Object.keys(errors).length > 0 || Object.keys(protocolErrors).length > 0) {
      setErrorMsg('Revisa los campos marcados antes de guardar.');
      // La pestaña con el primer error se abre y recibe el foco.
      openTab(tabWithErrors(errors, protocolErrors), true);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { data } = await api.post('/consultations/', {
        patient: patientId,
        admission_reason: admissionReason,
        clinical_procedure: Number(form.clinical_procedure),
        surgery_date: form.surgery_date,
        clinical_notes: clinicalNotes,
        clinical_data: protocolPayload(protocolFields, clinicalData),
        teeth: usesTeeth ? teeth : [],
        instructions,
        side_effects: sideEffects,
        diet_instructions: diet,
        // Vacío equivale a 0: el odontólogo decidió que no hace falta un control.
        next_control_in_days: Number(form.next_control_in_days || 0),
        prescribes_medication: prescribes,
        ...(prescribes ? medicationsPayload(medicationItems, instructions) : {}),
      });
      if (data.prescription) onPrescriptionAdded?.(data.prescription);
      onTreatmentAdded?.(data.treatment);
      setForm({ ...EMPTY_FORM, surgery_date: today() });
      setClinicalData({});
      setMedicationItems([newMedication()]);
      setPrescribes(true);
      setTeeth([]);
      setTab('procedimiento');
      setSuccessMsg(data.prescription
        ? 'Consulta registrada: la receta quedó vinculada al tratamiento activo.'
        : 'Consulta registrada: el tratamiento quedó activo, sin receta.');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (error) {
      const { errors: apiErrors, clinical } = flattenApiErrors(error.response?.data, API_FIELDS);
      if (error.response?.data?.medications) {
        setMedicationErrors(medicationListErrors(error.response.data.medications));
        apiErrors.medications = 'Revisa los medicamentos de la receta.';
      }
      setFieldErrors(apiErrors);
      setClinicalErrors(clinical);
      setErrorMsg(apiErrors.detail || 'No se pudo guardar la consulta. Revisa los datos e inténtalo nuevamente.');
      const withErrors = tabWithErrors(apiErrors, clinical);
      if (withErrors) openTab(withErrors, true);
    } finally {
      setLoading(false);
    }
  };

  const canSave = consultationReady && Boolean(form.instructions) && (!prescribes || medicationItems.every((item) => Boolean(item.medication_name && item.strength)));

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {errorMsg && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </p>
      )}
      {successMsg && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
          <IconCheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{successMsg}</span>
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200">
        <div role="tablist" aria-label="Registro de la consulta" className="-mb-px flex flex-wrap gap-1">
          {TABS.map(([id, label], index) => {
            const locked = index > 0 && !consultationReady;
            const hasErrors = tabWithErrors(fieldErrors, clinicalErrors) === id;
            return (
              <button
                key={id}
                ref={(element) => { tabRefs.current[id] = element; }}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-controls={`panel-${id}`}
                aria-selected={tab === id}
                tabIndex={tab === id ? 0 : -1}
                disabled={locked}
                title={locked ? 'Completa primero el motivo, el tratamiento y su fecha.' : undefined}
                onClick={() => openTab(id)}
                onKeyDown={(event) => {
                  const enabled = TABS.filter((_, position) => position === 0 || consultationReady).map(([key]) => key);
                  const position = enabled.indexOf(id);
                  const next = { ArrowRight: enabled[(position + 1) % enabled.length], ArrowLeft: enabled[(position - 1 + enabled.length) % enabled.length] }[event.key];
                  if (next) { event.preventDefault(); openTab(next, true); }
                }}
                className={`rounded-t-xl border px-3.5 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${tab === id ? 'border-slate-200 border-b-white bg-white text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {label}
                {hasErrors && <span className="ml-1.5 inline-flex align-[-2px] text-rose-600" role="img" aria-label="(con errores)"><IconAlertTriangle className="h-3.5 w-3.5" /></span>}
              </button>
            );
          })}
        </div>
        <Link to={`/panel-doctor/pacientes/${patientId}/historia`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 mb-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
          <IconHistory className="h-3.5 w-3.5 shrink-0" />Historial clínico
        </Link>
      </div>
      {!consultationReady && (
        <p className="text-[11px] text-slate-500">La medicación y los cuidados se habilitan al completar el motivo, el tratamiento y su fecha.</p>
      )}

      <section role="tabpanel" id="panel-procedimiento" aria-labelledby="tab-procedimiento" hidden={tab !== 'procedimiento'} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Motivo de consulta" name="admission_reason" value={form.admission_reason} onChange={update} placeholder="Ej. Dolor en tercer molar inferior derecho semiincluido" maxLength={240} error={fieldErrors.admission_reason} />
          </div>
          <label className="block text-xs font-bold text-slate-700">
            Especialidad
            <select name="specialty" value={form.specialty} onChange={update} className={selectClass(false)}>
              <option value="">Todas las especialidades</option>
              {specialties.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-700">
            Tratamiento o intervención
            <select name="clinical_procedure" value={form.clinical_procedure} onChange={update} className={selectClass(fieldErrors.clinical_procedure)}>
              <option value="">Selecciona el tratamiento realizado</option>
              {visibleProcedures.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            {fieldErrors.clinical_procedure && <span className="mt-1 block text-[11px] font-normal text-rose-600">{fieldErrors.clinical_procedure}</span>}
          </label>
          <Field label="Fecha de la intervención" type="date" name="surgery_date" value={form.surgery_date} max={today()} onChange={update} error={fieldErrors.surgery_date} />
          {selectedProcedure && <ProtocolPreview procedure={selectedProcedure} />}
        </div>
        {selectedProcedure && protocolFields.length > 0 && (
          <fieldset className="min-w-0 rounded-2xl border border-slate-200 p-4">
            <legend className="px-1 text-xs font-black text-slate-900">{`Datos de ${treatmentName}`}</legend>
            <ProtocolFields fields={protocolFields} values={clinicalData} errors={clinicalErrors} onChange={(values) => { setClinicalData(values); setClinicalErrors({}); setErrorMsg(''); }} />
          </fieldset>
        )}
        {usesTeeth && (
          <div>
            <p id="odontograma-titulo" className="mb-1 text-xs font-bold text-slate-700">Piezas tratadas: pulsa sobre los dientes afectados</p>
            <Odontogram value={teeth} onChange={setTeeth} dentition={dentition} onDentitionChange={setDentition} />
            {fieldErrors.teeth && <span className="mt-1 block text-[11px] font-normal text-rose-600">{fieldErrors.teeth}</span>}
          </div>
        )}
        <TextField label="Notas clínicas internas (opcional)" name="clinical_notes" value={form.clinical_notes} onChange={update} maxLength={1000} placeholder="Hallazgos, diagnóstico o detalles de la intervención para el equipo odontológico..." error={fieldErrors.clinical_notes} />
        {consultationReady && (
          <button type="button" onClick={() => openTab('medicacion', true)} className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:underline">Continuar con la medicación<IconArrowRight className="h-3.5 w-3.5 shrink-0" /></button>
        )}
      </section>

      <section role="tabpanel" id="panel-medicacion" aria-labelledby="tab-medicacion" hidden={tab !== 'medicacion'} className="space-y-3">
        <p className="text-[11px] text-slate-500">
          {prescribes ? `Receta para ${treatmentName} del ${formatDate(form.surgery_date)}.` : `Sin receta para ${treatmentName}.`}
        </p>
        <CheckField
          name="prescribes_medication"
          label="Recetar medicación en esta consulta"
          hint={selectedProcedure?.medication_default === false
            ? 'Este tratamiento no suele llevar receta. Actívalo solo si el caso lo requiere.'
            : 'Desactívalo si en esta consulta no se receta ningún medicamento.'}
          checked={prescribes}
          onChange={(event) => { setPrescribes(event.target.checked); setErrorMsg(''); }}
        />
        {prescribes && <MedicationList items={medicationItems} errors={medicationErrors.list} general={medicationErrors.general} onChange={updateMedications} />}
        <button type="button" onClick={() => openTab('cuidados', true)} className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:underline">Continuar con cuidados y dieta<IconArrowRight className="h-3.5 w-3.5 shrink-0" /></button>
      </section>

      <section role="tabpanel" id="panel-cuidados" aria-labelledby="tab-cuidados" hidden={tab !== 'cuidados'} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><PresetTextField field="instructions" specialty={selectedProcedure?.specialty} label="Indicaciones y cuidados" name="instructions" value={form.instructions} onChange={update} required maxLength={1000} placeholder="Qué debe hacer y qué debe evitar..." error={fieldErrors.instructions} /></div>
        <div className="sm:col-span-2"><PresetTextField field="diet" specialty={selectedProcedure?.specialty} label="Dieta (opcional)" name="diet_instructions" value={form.diet_instructions} onChange={update} maxLength={1000} placeholder="Ej. Dieta blanda y fría las primeras 24 horas; evita alimentos duros y pegajosos." error={fieldErrors.diet_instructions} /></div>
        <PresetTextField field="side_effects" specialty={selectedProcedure?.specialty} label="Efectos que debe observar (opcional)" name="side_effects" value={form.side_effects} onChange={update} maxLength={500} placeholder="Ej. Malestar estomacal leve..." error={fieldErrors.side_effects} />
        <NextControlField value={form.next_control_in_days} onChange={update} error={fieldErrors.next_control_in_days} returnDate={returnDate} />
        <p className="text-[11px] text-slate-500 sm:col-span-2">El paciente verá las indicaciones y la dieta tal como las escribas; el asistente solo podrá citarlas al responder sus dudas.</p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="max-w-xl text-[11px] text-slate-500">El análisis automático orienta cuidados básicos y señales de alerta; no reemplaza el criterio profesional.</p>
        <button type="submit" disabled={loading || !patientId || !canSave} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          <IconPill className="h-4 w-4" />
          {loading ? 'Guardando consulta...' : prescribes ? 'Guardar consulta y receta' : 'Guardar consulta'}
        </button>
      </div>
    </form>
  );
}

const selectClass = (error) => `mt-1 w-full rounded-xl border ${error ? 'border-rose-400' : 'border-slate-200'} bg-white p-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100`;

const UNIT_LABELS = { days: 'días', weeks: 'semanas' };

// Lo que el protocolo hará por el paciente: fases, cuidados diarios, reportes y controles.
function ProtocolPreview({ procedure }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-[11px] text-blue-900 sm:col-span-2">
      <p className="font-bold">{procedure.specialty_label} · seguimiento en {UNIT_LABELS[procedure.follow_up_unit] || 'días'}, reporte cada {procedure.checkin_every_days} {procedure.checkin_every_days === 1 ? 'día' : 'días'}</p>
      {procedure.control_every_days > 0 && <p className="mt-1">Control en consultorio cada {procedure.control_every_days} días</p>}
      {procedure.default_phases?.length > 0 && (
        <p className="mt-1">Fases: {procedure.default_phases.map((phase) => phase.name).join(' → ')}</p>
      )}
      {procedure.care_items?.length > 0 && (
        <p className="mt-1">Checklist del paciente: {procedure.care_items.join(' · ')}</p>
      )}
    </div>
  );
}

function formatDate(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' });
}

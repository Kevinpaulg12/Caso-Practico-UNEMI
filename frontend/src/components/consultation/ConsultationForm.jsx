import { useEffect, useState } from 'react';
import api from '../../services/api';
import { fetchAll } from '../../services/pagination';
import {
  EMPTY_MEDICATION,
  INICIO,
  fieldsFor,
  flattenApiErrors,
  medicationPayload,
  nextControlDate,
  protocolPayload,
  today,
  validateMedication,
  validateNextControl,
  validateProtocolFields,
} from '../../services/consultationRules';
import { IconAlertTriangle, IconCheckCircle, IconPill } from '../Icons';
import Odontogram from '../Odontogram';
import MedicationSection from './MedicationSection';
import ProtocolFields from './ProtocolFields';
import { CheckField, Field, NextControlField, Step, TextField } from './fields';

// Nombres de la API que en el formulario tienen otro campo.
const API_FIELDS = { details: 'instructions', procedure: 'clinical_procedure', start_date: 'surgery_date' };

const EMPTY_FORM = {
  admission_reason: '',
  specialty: '',
  clinical_procedure: '',
  clinical_notes: '',
  instructions: '',
  side_effects: '',
  next_control_in_days: '',
};

// Inicio de un tratamiento: el formulario se adapta al tratamiento elegido (sus datos, si lleva receta
// y cuándo debe volver el paciente).
export default function ConsultationForm({ onPrescriptionAdded, onTreatmentAdded, patientId }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, surgery_date: today() });
  const [clinicalData, setClinicalData] = useState({});
  const [prescribes, setPrescribes] = useState(true);
  const [medication, setMedication] = useState(EMPTY_MEDICATION);
  // Cambia al guardar: reinicia el buscador de medicamentos.
  const [medicationKey, setMedicationKey] = useState(0);
  const [teeth, setTeeth] = useState([]);
  const [dentition, setDentition] = useState('permanent');
  const [procedures, setProcedures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [clinicalErrors, setClinicalErrors] = useState({});

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

  const updateMedication = (patch) => {
    setMedication((current) => ({ ...current, ...patch }));
    setFieldErrors((current) => ({ ...current, ...Object.fromEntries(Object.keys(patch).map((key) => [key, ''])) }));
    setErrorMsg('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!patientId) return;
    const admissionReason = form.admission_reason.trim();
    const instructions = form.instructions.trim();
    const sideEffects = form.side_effects.trim();
    const clinicalNotes = form.clinical_notes.trim();
    const errors = prescribes ? validateMedication(medication) : {};
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
        // Vacío equivale a 0: el odontólogo decidió que no hace falta un control.
        next_control_in_days: Number(form.next_control_in_days || 0),
        prescribes_medication: prescribes,
        ...(prescribes ? medicationPayload(medication, instructions) : {}),
      });
      if (data.prescription) onPrescriptionAdded?.(data.prescription);
      onTreatmentAdded?.(data.treatment);
      setForm({ ...EMPTY_FORM, surgery_date: today() });
      setClinicalData({});
      setMedication(EMPTY_MEDICATION);
      setMedicationKey((key) => key + 1);
      setPrescribes(true);
      setTeeth([]);
      setSuccessMsg(data.prescription
        ? 'Consulta registrada: la receta quedó vinculada al tratamiento activo.'
        : 'Consulta registrada: el tratamiento quedó activo, sin receta.');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (error) {
      const { errors: apiErrors, clinical } = flattenApiErrors(error.response?.data, API_FIELDS);
      setFieldErrors(apiErrors);
      setClinicalErrors(clinical);
      setErrorMsg(apiErrors.detail || 'No se pudo guardar la consulta. Revisa los datos e inténtalo nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  const medicationDone = !prescribes
    || Boolean(medication.medication_name && medication.strength && medication.dosage_form && medication.frequency && medication.duration);
  const canSave = consultationReady && Boolean(form.instructions) && (!prescribes || Boolean(medication.medication_name && medication.strength));

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

      <Step number={1} title="Motivo de consulta y tratamiento" description="Registra por qué acude el paciente y qué tratamiento se le realizó: el resto del formulario se adapta a él." done={consultationReady}>
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
      </Step>

      <Step
        number={2}
        title={selectedProcedure ? `Datos de ${treatmentName}` : 'Datos del tratamiento'}
        description={consultationReady ? 'Lo que este tratamiento necesita dejar registrado.' : 'Se habilita cuando completes el motivo, el tratamiento y su fecha.'}
        done={consultationReady && Object.keys(validateProtocolFields(protocolFields, clinicalData)).length === 0}
        disabled={!consultationReady}
      >
        <div className="space-y-3">
          <ProtocolFields fields={protocolFields} values={clinicalData} errors={clinicalErrors} onChange={(values) => { setClinicalData(values); setClinicalErrors({}); setErrorMsg(''); }} />
          {usesTeeth && (
            <div>
              <p className="mb-1 text-xs font-bold text-slate-700">Piezas tratadas (opcional)</p>
              <Odontogram value={teeth} onChange={setTeeth} dentition={dentition} onDentitionChange={setDentition} />
              {fieldErrors.teeth && <span className="mt-1 block text-[11px] font-normal text-rose-600">{fieldErrors.teeth}</span>}
            </div>
          )}
          <TextField label="Notas clínicas internas (opcional)" name="clinical_notes" value={form.clinical_notes} onChange={update} maxLength={1000} placeholder="Hallazgos, diagnóstico o detalles de la intervención para el equipo odontológico..." error={fieldErrors.clinical_notes} />
        </div>
      </Step>

      <Step
        number={3}
        title="Medicación"
        description={!consultationReady
          ? 'Se habilita cuando completes el motivo, el tratamiento y su fecha.'
          : prescribes ? `Receta para ${treatmentName} del ${formatDate(form.surgery_date)}.` : `Sin receta para ${treatmentName}.`}
        done={consultationReady && medicationDone}
        disabled={!consultationReady}
      >
        <div className="space-y-3">
          <CheckField
            name="prescribes_medication"
            label="Recetar medicación en esta consulta"
            hint={selectedProcedure?.medication_default === false
              ? 'Este tratamiento no suele llevar receta. Actívalo solo si el caso lo requiere.'
              : 'Desactívalo si en esta consulta no se receta ningún medicamento.'}
            checked={prescribes}
            onChange={(event) => { setPrescribes(event.target.checked); setErrorMsg(''); }}
          />
          {prescribes && <MedicationSection key={medicationKey} values={medication} errors={fieldErrors} onChange={updateMedication} />}
        </div>
      </Step>

      <Step number={4} title="Indicaciones y próximo control" description="El paciente verá las indicaciones tal como las escribas y recibirá el aviso de cuándo debe volver." done={consultationReady && form.instructions.trim().length >= 10} disabled={!consultationReady}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Indicaciones y cuidados" name="instructions" value={form.instructions} onChange={update} required maxLength={1000} placeholder="Qué debe hacer y qué debe evitar..." error={fieldErrors.instructions} />
          <TextField label="Efectos que debe observar (opcional)" name="side_effects" value={form.side_effects} onChange={update} maxLength={500} placeholder="Ej. Malestar estomacal leve..." error={fieldErrors.side_effects} />
          <NextControlField value={form.next_control_in_days} onChange={update} error={fieldErrors.next_control_in_days} returnDate={returnDate} />
        </div>
      </Step>

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

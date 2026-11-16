import { useState } from 'react';
import api from '../../services/api';
import {
  CONTROL,
  EMPTY_MEDICATION,
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
import { IconAlertTriangle } from '../Icons';
import MedicationSection from './MedicationSection';
import ProtocolFields from './ProtocolFields';
import { CheckField, Field, NextControlField, TextField } from './fields';

// Control de un tratamiento en curso: lo que se revisó hoy y cuándo debe volver el paciente.
export default function ControlForm({ plan, onSaved, onCancel }) {
  const protocol = plan.procedure_detail;
  const fields = fieldsFor(protocol, CONTROL);
  const [form, setForm] = useState({
    date: today(),
    notes: '',
    instructions: '',
    next_control_in_days: protocol?.control_every_days != null ? String(protocol.control_every_days) : '',
  });
  const [clinicalData, setClinicalData] = useState({});
  const [prescribes, setPrescribes] = useState(false);
  const [medication, setMedication] = useState(EMPTY_MEDICATION);
  const [errors, setErrors] = useState({});
  const [clinicalErrors, setClinicalErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const treatment = protocol?.name || plan.procedure || plan.title;
  const returnDate = nextControlDate(form.date, form.next_control_in_days);

  const update = ({ target }) => {
    const value = target.name === 'next_control_in_days' ? target.value.replace(/\D/g, '').slice(0, 3) : target.value;
    setForm((current) => ({ ...current, [target.name]: value }));
    setErrors((current) => ({ ...current, [target.name]: '' }));
    setError('');
  };

  const save = async (event) => {
    event.preventDefault();
    const notes = form.notes.trim();
    const instructions = form.instructions.trim();
    const nextErrors = prescribes ? validateMedication(medication) : {};
    if (!form.date || form.date > today()) nextErrors.date = 'Indica una fecha de control que no sea futura.';
    else if (plan.surgery_date && form.date < plan.surgery_date) nextErrors.date = 'El control no puede ser anterior al inicio del tratamiento.';
    if (notes.length > 1000) nextErrors.notes = 'No puede superar 1000 caracteres.';
    if (instructions && (instructions.length < 10 || instructions.length > 1000)) nextErrors.instructions = 'Escribe indicaciones entre 10 y 1000 caracteres.';
    const controlError = validateNextControl(form.next_control_in_days);
    if (controlError) nextErrors.next_control_in_days = controlError;
    const protocolErrors = validateProtocolFields(fields, clinicalData);
    setErrors(nextErrors);
    setClinicalErrors(protocolErrors);
    if (Object.keys(nextErrors).length || Object.keys(protocolErrors).length) {
      setError('Revisa los campos marcados antes de guardar.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/treatment-plans/${plan.id}/controls/`, {
        date: form.date,
        notes,
        clinical_data: protocolPayload(fields, clinicalData),
        next_control_in_days: Number(form.next_control_in_days || 0),
        instructions: instructions || undefined,
        prescribes_medication: prescribes,
        ...(prescribes ? medicationPayload(medication, instructions || plan.instructions) : {}),
      });
      onSaved(data);
    } catch (requestError) {
      const { errors: apiErrors, clinical } = flattenApiErrors(requestError.response?.data);
      setErrors(apiErrors);
      setClinicalErrors(clinical);
      setError(apiErrors.detail || 'No se pudo guardar el control. Revisa los datos e inténtalo nuevamente.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="space-y-4 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm">
      <div>
        <h3 className="text-sm font-black text-slate-900">Registrar control de {treatment.toLowerCase()}</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          El control reinicia el seguimiento diario del paciente y define cuándo debe volver. No se agenda una hora.
        </p>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <IconAlertTriangle className="h-4 w-4 shrink-0" />{error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fecha del control" type="date" name="date" value={form.date} min={plan.surgery_date || undefined} max={today()} onChange={update} error={errors.date} />
        <NextControlField value={form.next_control_in_days} onChange={update} error={errors.next_control_in_days} returnDate={returnDate} />
      </div>
      <ProtocolFields fields={fields} values={clinicalData} errors={clinicalErrors} onChange={(values) => { setClinicalData(values); setClinicalErrors({}); setError(''); }} />
      <TextField label="Notas del control (opcional)" name="notes" value={form.notes} onChange={update} maxLength={1000} placeholder="Qué se hizo y qué se observó en esta visita..." error={errors.notes} />
      <TextField label="Indicaciones nuevas para el paciente (opcional)" name="instructions" value={form.instructions} onChange={update} maxLength={1000} placeholder="Déjalo vacío para mantener las indicaciones actuales." error={errors.instructions} />
      <CheckField
        name="prescribes_medication"
        label="Recetar o cambiar la medicación"
        hint="Se emite una receta nueva y la anterior queda en el historial."
        checked={prescribes}
        onChange={(event) => { setPrescribes(event.target.checked); setError(''); }}
      />
      {prescribes && (
        <MedicationSection
          values={medication}
          errors={errors}
          onChange={(patch) => {
            setMedication((current) => ({ ...current, ...patch }));
            setErrors((current) => ({ ...current, ...Object.fromEntries(Object.keys(patch).map((key) => [key, ''])) }));
            setError('');
          }}
        />
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancelar
          </button>
        )}
        <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Guardando...' : 'Guardar control'}
        </button>
      </div>
    </form>
  );
}

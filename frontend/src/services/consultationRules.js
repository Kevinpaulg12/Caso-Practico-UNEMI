// Reglas de la consulta y del control: las mismas que valida el servidor (medical_monitor/consultations.py).

export const INICIO = 'inicio';
export const CONTROL = 'control';
export const MAX_CONTROL_DAYS = 730;

export const EMPTY_MEDICATION = {
  medication_name: '',
  active_ingredient: '',
  strength: '',
  dosage_form: '',
  frequency: '',
  duration: '',
  // Vía, toma con alimentos y efectos frecuentes: se completan al elegir el fármaco.
  notes: '',
};

export function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function formatLongDate(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Campos que el protocolo pide al iniciar el tratamiento o en un control.
export function fieldsFor(procedure, moment) {
  return (procedure?.consultation_fields ?? []).filter((field) => (field.en ?? [INICIO]).includes(moment));
}

const isEmpty = (value) => value === undefined || value === null || String(value).trim() === '';

export function validateProtocolFields(fields, values) {
  const errors = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === 'boolean') continue;
    if (isEmpty(value)) {
      if (field.required) errors[field.key] = 'Completa este dato.';
    } else if (field.type === 'number') {
      const number = Number(value);
      const low = field.min ?? 0;
      const high = field.max ?? 999;
      if (!Number.isInteger(number) || number < low || number > high) errors[field.key] = `Indica un número entre ${low} y ${high}.`;
    } else if (field.type === 'text' && String(value).trim().length > 200) {
      errors[field.key] = 'No puede superar 200 caracteres.';
    }
  }
  return errors;
}

// Valores listos para enviar: números como números, sí/no siempre presente y sin campos vacíos.
export function protocolPayload(fields, values) {
  const data = {};
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === 'boolean') data[field.key] = Boolean(value);
    else if (!isEmpty(value)) data[field.key] = field.type === 'number' ? Number(value) : String(value).trim();
  }
  return data;
}

export function validateMedication(medication) {
  const errors = {};
  const name = medication.medication_name.trim();
  const ingredient = medication.active_ingredient.trim();
  if (name.length < 2 || name.length > 120) errors.medication_name = 'Indica un medicamento entre 2 y 120 caracteres.';
  if (ingredient.length < 2 || ingredient.length > 120) errors.active_ingredient = 'Indica el principio activo entre 2 y 120 caracteres.';
  if (!medication.strength) errors.strength = 'Selecciona una concentración.';
  if (!medication.dosage_form) errors.dosage_form = 'Selecciona una presentación.';
  if (!medication.frequency) errors.frequency = 'Selecciona una frecuencia.';
  if (!/^[1-9]\d{0,2}$/.test(medication.duration)) errors.duration = 'Indica entre 1 y 999 días.';
  if ((medication.notes ?? '').length > 500) errors.notes = 'No puede superar 500 caracteres.';
  return errors;
}

// La receta tal como la espera la API; `details` es el texto completo que lee el paciente.
export function medicationPayload(medication, instructions) {
  const name = medication.medication_name.trim();
  return {
    medication_name: name,
    active_ingredient: medication.active_ingredient.trim(),
    strength: medication.strength,
    dosage_form: medication.dosage_form,
    frequency: medication.frequency,
    duration: `${medication.duration} días`,
    details: [
      `${name} ${medication.strength}`.trim(),
      medication.dosage_form.toLowerCase(),
      medication.frequency.toLowerCase(),
      `durante ${medication.duration} días`,
      (medication.notes ?? '').trim().replace(/\.$/, ''),
      instructions,
    ].filter(Boolean).join('. '),
  };
}

export function validateNextControl(value) {
  if (value === '') return '';
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= MAX_CONTROL_DAYS
    ? ''
    : `Indica entre 0 y ${MAX_CONTROL_DAYS} días (0 = no requiere control).`;
}

// Fecha (AAAA-MM-DD) en que el paciente debe volver; null si no requiere control.
export function nextControlDate(from, days) {
  if (!from || days === '' || !Number.isInteger(Number(days)) || Number(days) <= 0) return null;
  const date = new Date(`${from}T00:00:00`);
  date.setDate(date.getDate() + Number(days));
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Texto corto del próximo control a partir de {date, days_left, overdue} de la API.
export function describeNextControl(control) {
  if (!control) return '';
  const days = control.days_left;
  if (days > 1) return `Control en ${days} días`;
  if (days === 1) return 'Control mañana';
  if (days === 0) return 'Control hoy';
  return `Control atrasado ${-days} ${days === -1 ? 'día' : 'días'}`;
}

// Errores de la API ({campo: mensaje | [mensaje] | {subcampo: mensaje}}) como texto por campo.
export function flattenApiErrors(data, rename = {}) {
  const errors = {};
  let clinical = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (key === 'clinical_data' && value && typeof value === 'object' && !Array.isArray(value)) clinical = value;
    else errors[rename[key] ?? key] = Array.isArray(value) ? value[0] : value;
  }
  return { errors, clinical };
}

// --- Varios medicamentos por receta ------------------------------------------------------------------
export const MAX_MEDICATIONS = 10;
let medicationSeed = 0;

// Un medicamento vacío con una clave estable para la lista (no viaja a la API).
export function newMedication() {
  medicationSeed += 1;
  return { ...EMPTY_MEDICATION, uid: `med-${medicationSeed}` };
}

// Errores por medicamento, alineados con la lista; null si todos son válidos.
export function validateMedications(items) {
  const errors = items.map(validateMedication);
  const names = items.map((item) => item.medication_name.trim().toLowerCase());
  names.forEach((name, index) => {
    if (name && names.indexOf(name) !== index) errors[index].medication_name = 'Este medicamento ya está en la receta.';
  });
  return errors.some((item) => Object.keys(item).length) ? errors : null;
}

// La receta completa para la API: { medications: [...] }.
export function medicationsPayload(items, instructions) {
  return { medications: items.map((item) => medicationPayload(item, instructions)) };
}

// Errores de la API para la lista ({medications: [{campo: [msg]}]} o un mensaje general).
export function medicationListErrors(value) {
  if (!Array.isArray(value)) return { list: [], general: Array.isArray(value) ? value[0] : value || '' };
  return {
    list: value.map((item) => Object.fromEntries(Object.entries(item || {}).map(([key, message]) => [key, Array.isArray(message) ? message[0] : message]))),
    general: '',
  };
}

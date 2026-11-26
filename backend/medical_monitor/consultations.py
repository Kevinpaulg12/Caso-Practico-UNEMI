"""Reglas del registro clínico: la consulta que inicia un tratamiento y cada control posterior.

Cada protocolo define qué datos se anotan (`consultation_fields`), si suele llevar receta y cada
cuántos días debe volver el paciente. Aquí se validan esos datos y se registra el control.
"""
import re
from datetime import date, timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .appointments import mark_attended
from .models import ControlVisit, TreatmentPlan
from .treatments import MAX_MEDICATIONS, MEDICATION_FIELDS, advance_phase, display_clinical_data, next_phase, replace_prescriptions

INICIO, CONTROL = 'inicio', 'control'
DURATION = re.compile(r'[1-9]\d{0,2}\s*(día|días|semana|semanas|mes|meses)', re.IGNORECASE)
MAX_CONTROL_DAYS = 730
MAX_TEXT = 200


def text(data, key):
    return str(data.get(key) or '').strip()


def wants_medication(data, default):
    """La receta es opcional: un control de ortodoncia, por ejemplo, no la lleva."""
    flag = data.get('prescribes_medication')
    if flag is None:
        return default
    return flag is True or str(flag).lower() in ('true', '1')


def clean_medication(data):
    """Devuelve (medicación, errores). Las mismas reglas valen para la consulta y para el control."""
    values = {field: text(data, field) for field in ('active_ingredient', *MEDICATION_FIELDS)}
    errors = {}
    if not 2 <= len(values['medication_name']) <= 120:
        errors['medication_name'] = 'Indica un medicamento válido.'
    if not 1 <= len(values['active_ingredient']) <= 120:
        errors['active_ingredient'] = 'Indica el principio activo.'
    if not values['strength'] or len(values['strength']) > 40:
        errors['strength'] = 'Selecciona una concentración válida.'
    if not 1 <= len(values['dosage_form']) <= 60:
        errors['dosage_form'] = 'Selecciona una presentación.'
    if not 1 <= len(values['frequency']) <= 120:
        errors['frequency'] = 'Selecciona una frecuencia.'
    if not DURATION.fullmatch(values['duration']):
        errors['duration'] = 'Usa un formato como 3 días.'
    return values, errors


def clean_medications(data):
    """Devuelve (lista de medicamentos, errores).

    Acepta `medications: [...]` (uno o más) o, por compatibilidad, los campos de un solo medicamento.
    Con la lista, los errores van en `medications` alineados por posición: [{campo: mensaje}, ...].
    """
    raw = data.get('medications')
    if raw is None:
        item, errors = clean_medication(data)
        return [item], errors
    if not isinstance(raw, list) or not raw:
        return [], {'medications': 'Agrega al menos un medicamento.'}
    if len(raw) > MAX_MEDICATIONS:
        return [], {'medications': f'Una receta admite como máximo {MAX_MEDICATIONS} medicamentos.'}
    items, item_errors = [], []
    for entry in raw:
        entry = entry if isinstance(entry, dict) else {}
        item, errors = clean_medication(entry)
        # Texto completo de esa receta (vía, alimentos, notas) tal como lo compuso el formulario.
        details = text(entry, 'details')
        if details:
            if len(details) > 2000:
                errors['details'] = 'El texto de la receta no puede superar 2000 caracteres.'
            item['details'] = details
        items.append(item)
        item_errors.append(errors)
    names = [item['medication_name'].lower() for item in items]
    for index, name in enumerate(names):
        if name and names.index(name) != index:
            item_errors[index]['medication_name'] = 'Este medicamento ya está en la receta.'
    return items, ({'medications': item_errors} if any(item_errors) else {})


def compose_details(medication, instructions):
    """Texto completo de la receta: medicamento, pauta e indicaciones."""
    return '. '.join(part for part in (
        f'{medication["medication_name"]} {medication["strength"]}'.strip(),
        medication['dosage_form'].lower(),
        medication['frequency'].lower(),
        f'durante {medication["duration"]}' if medication['duration'] else '',
        instructions,
    ) if part)


def fields_for(protocol, moment):
    """Campos del protocolo que se piden al iniciar el tratamiento o en un control."""
    fields = getattr(protocol, 'consultation_fields', None) or []
    return [field for field in fields if moment in field.get('en', [INICIO])]


def _clean_value(field, value):
    """Devuelve (valor, error) de un campo del protocolo."""
    kind = field.get('type', 'text')
    if kind == 'boolean':
        return (value, None) if isinstance(value, bool) else (None, 'Indica sí o no.')
    if kind == 'select':
        return (value, None) if value in field.get('options', []) else (None, 'Elige una de las opciones.')
    if kind == 'number':
        if isinstance(value, str) and value.strip().isdigit():
            value = int(value)
        low, high = field.get('min', 0), field.get('max', 999)
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            return None, f'Indica un número entre {low} y {high}.'
        return value, None
    value = str(value).strip()
    if len(value) > MAX_TEXT:
        return None, f'No puede superar {MAX_TEXT} caracteres.'
    return value, None


def clean_clinical_data(protocol, raw, moment):
    """Valida los datos propios del tratamiento. Devuelve (valores, errores por campo)."""
    if raw in (None, ''):
        raw = {}
    if not isinstance(raw, dict):
        return {}, {'detail': 'Los datos del tratamiento no tienen un formato válido.'}
    values, errors = {}, {}
    for field in fields_for(protocol, moment):
        key = field['key']
        value = raw.get(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            if field.get('required'):
                errors[key] = 'Completa este dato.'
            continue
        cleaned, error = _clean_value(field, value)
        if error:
            errors[key] = error
        elif cleaned != '':
            values[key] = cleaned
    return values, errors


def clean_next_control(data, protocol, errors):
    """Días hasta el próximo control: los que indique el odontólogo o, si no, los del protocolo."""
    raw = data.get('next_control_in_days')
    if raw is None or raw == '':
        return getattr(protocol, 'control_every_days', 0) or 0
    if isinstance(raw, str) and raw.strip().isdigit():
        raw = int(raw)
    if not isinstance(raw, int) or isinstance(raw, bool) or not 0 <= raw <= MAX_CONTROL_DAYS:
        errors['next_control_in_days'] = f'Indica entre 0 y {MAX_CONTROL_DAYS} días (0 = no requiere control).'
        return 0
    return raw


def next_control_from(reference, days):
    return reference + timedelta(days=days) if days else None


def control_payload(visit):
    doctor = visit.doctor
    return {
        'id': visit.id,
        'date': visit.date,
        'notes': visit.notes,
        'clinical_data': display_clinical_data(visit.treatment_plan.clinical_procedure, visit.clinical_data),
        'next_control_in_days': visit.next_control_in_days,
        'author': (doctor.get_full_name() or doctor.username) if doctor else None,
    }


def next_control_payload(plan, today=None):
    """Próximo control del tratamiento: {date, days_left, overdue}; None si no hay uno pendiente."""
    if not plan.is_active or plan.next_control_date is None:
        return None
    days_left = (plan.next_control_date - (today or timezone.localdate())).days
    return {'date': plan.next_control_date, 'days_left': days_left, 'overdue': days_left < 0}


def register_control(plan, doctor, data):
    """Registra un control realizado: reinicia el seguimiento diario y fija cuándo debe volver el paciente."""
    if not isinstance(data, dict):
        raise ValidationError({'detail': 'El cuerpo debe ser un objeto JSON.'})
    if not plan.is_active:
        raise ValidationError({'detail': 'El tratamiento ya fue cerrado.'})
    protocol = plan.clinical_procedure
    errors = {}

    visit_date = timezone.localdate()
    if data.get('date'):
        try:
            visit_date = date.fromisoformat(str(data['date']))
        except ValueError:
            errors['date'] = 'Usa una fecha válida para el control.'
        else:
            if visit_date > timezone.localdate():
                errors['date'] = 'La fecha del control no puede estar en el futuro.'
            elif visit_date < plan.surgery_date:
                errors['date'] = 'El control no puede ser anterior al inicio del tratamiento.'
    notes = text(data, 'notes')
    if len(notes) > 1000:
        errors['notes'] = 'Las notas no pueden superar 1000 caracteres.'
    clinical_data, field_errors = clean_clinical_data(protocol, data.get('clinical_data'), CONTROL)
    if field_errors:
        errors['clinical_data'] = field_errors
    days = clean_next_control(data, protocol, errors)
    instructions = text(data, 'instructions')
    if instructions and not 10 <= len(instructions) <= 1000:
        errors['instructions'] = 'Escribe indicaciones entre 10 y 1000 caracteres.'
    medications = []
    if wants_medication(data, default=False):
        medications, medication_errors = clean_medications(data)
        errors.update(medication_errors)
    medication = medications[0] if medications else None
    # La fase del tratamiento se completa al registrar el control que la cierra.
    advances = data.get('advance_phase') is True or str(data.get('advance_phase', '')).lower() == 'true'
    if advances and next_phase(plan)[1] is None:
        errors['advance_phase'] = 'Es la última fase del tratamiento. Para terminarlo, registra el alta.'
    if errors:
        raise ValidationError(errors)

    visit = ControlVisit.objects.create(
        treatment_plan=plan, doctor=doctor, date=visit_date, notes=notes,
        clinical_data=clinical_data, next_control_in_days=days,
    )
    # El control es una intervención: reinicia el conteo de días de seguimiento.
    plan.last_intervention_date = max(filter(None, (visit_date, plan.last_intervention_date)))
    plan.next_control_date = next_control_from(visit_date, days)
    if instructions:
        plan.instructions = instructions
    if medication:
        if plan.title == plan.medication_name:
            plan.title = medication['medication_name']
        if plan.schedule_description == plan.frequency or not plan.medication_name:
            plan.schedule_description = medication['frequency']
        for field in MEDICATION_FIELDS:
            setattr(plan, field, medication[field])
        plan.treatment_type = TreatmentPlan.TreatmentType.MEDICATION
    plan.save()
    if medications:
        replace_prescriptions(plan, doctor, medications)
    if advances:
        advance_phase(plan, doctor, on=visit_date)
    # Si el paciente había reservado una cita ese día, queda atendida.
    mark_attended(plan.patient, visit_date)
    return visit

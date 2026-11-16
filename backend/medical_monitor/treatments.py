"""Gestión de tratamientos en curso: edición con registro de cambios e historial unificado."""
import re
from datetime import datetime, time

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import Prescription, TreatmentChange
from .services import analyze_medical_text

MEDICATION_FIELDS = ('medication_name', 'strength', 'dosage_form', 'frequency', 'duration')
# Campos que se describen con su valor anterior y el nuevo; los textos largos solo se mencionan.
SHORT_FIELDS = {
    'medication_name': 'Medicamento',
    'strength': 'Concentración',
    'dosage_form': 'Presentación',
    'frequency': 'Frecuencia',
    'duration': 'Duración',
    'start_date': 'Fecha de la cirugía',
    'clinical_procedure': 'Intervención',
    'teeth': 'Piezas',
}
LONG_FIELDS = {
    'instructions': 'Indicaciones actualizadas',
    'side_effects': 'Efectos a observar actualizados',
    'clinical_notes': 'Notas clínicas actualizadas',
    'admission_reason': 'Motivo de consulta actualizado',
}
TRACKED_FIELDS = (*SHORT_FIELDS, *LONG_FIELDS)
DURATION_PATTERN = re.compile(r'[1-9]\d{0,2}\s*(día|días|semana|semanas|mes|meses)', re.IGNORECASE)


def display_clinical_data(protocol, data):
    """Datos del tratamiento con su etiqueta, en el orden del protocolo: [{label, value}]."""
    labels = {field['key']: field['label'] for field in (getattr(protocol, 'consultation_fields', None) or [])}
    ordered = [key for key in labels if key in (data or {})] + [key for key in (data or {}) if key not in labels]
    return [
        {'label': labels.get(key, key), 'value': ('Sí' if data[key] else 'No') if isinstance(data[key], bool) else str(data[key])}
        for key in ordered
    ]


def snapshot(plan):
    return {field: getattr(plan, field) for field in TRACKED_FIELDS}


def validate_edit(plan, data):
    """Reglas de una edición; las mismas que al registrar la consulta."""
    if not plan.is_active:
        raise ValidationError({'detail': 'Este tratamiento ya fue cerrado; no se puede modificar.'})
    errors = {}
    if 'medication_name' in data and plan.medication_name and not 2 <= len(data['medication_name'].strip()) <= 120:
        errors['medication_name'] = 'Indica un medicamento válido.'
    for field, message in (('strength', 'Indica la concentración.'), ('dosage_form', 'Selecciona una presentación.'),
                           ('frequency', 'Selecciona una frecuencia.')):
        if field in data and plan.medication_name and not data[field].strip():
            errors[field] = message
    if 'duration' in data and plan.medication_name and not DURATION_PATTERN.fullmatch(data['duration'].strip()):
        errors['duration'] = 'Usa un formato como 3 días.'
    if 'instructions' in data and len(data['instructions'].strip()) < 10:
        errors['instructions'] = 'Escribe indicaciones de al menos 10 caracteres.'
    if 'is_active' in data and data['is_active'] is not True:
        errors['is_active'] = 'Para cerrar el tratamiento usa el alta médica.'
    if errors:
        raise ValidationError(errors)


def _display(value):
    if value in (None, '', []):
        return '—'
    if isinstance(value, list):
        return ', '.join(map(str, value))
    return getattr(value, 'name', None) or str(value)


def describe_changes(before, plan):
    changes = []
    for field, label in SHORT_FIELDS.items():
        old, new = before[field], getattr(plan, field)
        if old != new:
            changes.append(f'{label}: {_display(old)} → {_display(new)}')
    for field, phrase in LONG_FIELDS.items():
        if before[field] != getattr(plan, field):
            changes.append(phrase)
    return changes


def replace_prescription(plan, doctor, active_ingredient=''):
    """Cambio de medicación: la receta anterior queda en el historial y se emite una nueva."""
    previous = plan.prescriptions.filter(is_active=True).order_by('-created_at').first()
    plan.prescriptions.filter(is_active=True).update(is_active=False)
    details = '. '.join(part for part in (
        f'{plan.medication_name} {plan.strength}'.strip(),
        plan.dosage_form.lower(),
        plan.frequency.lower(),
        f'durante {plan.duration}' if plan.duration else '',
        plan.instructions.strip(),
    ) if part)
    same_medication = previous and previous.medication_name == plan.medication_name
    nlp_result = analyze_medical_text(details)
    return Prescription.objects.create(
        doctor=doctor,
        patient=plan.patient,
        treatment_plan=plan,
        details=details,
        medication_name=plan.medication_name,
        active_ingredient=active_ingredient or (
            previous.active_ingredient if same_medication else plan.medication_name.split(' ')[0]
        ),
        strength=plan.strength,
        dosage_form=plan.dosage_form,
        frequency=plan.frequency,
        duration=plan.duration,
        nlp_severity=nlp_result['severity'],
        extracted_entities=nlp_result['entities'],
    )


def record_edit(plan, before, doctor):
    """Registra lo que cambió; si cambió la medicación, emite la receta nueva. Devuelve los cambios."""
    changes = describe_changes(before, plan)
    if not changes:
        return []
    # El cambio se registra antes que la receta nueva para que la línea de tiempo los muestre en ese orden.
    TreatmentChange.objects.create(treatment_plan=plan, author=doctor, summary='; '.join(changes))
    if plan.medication_name and any(before[field] != getattr(plan, field) for field in MEDICATION_FIELDS):
        replace_prescription(plan, doctor)
    return changes


def _author(user):
    if user is None:
        return None
    return user.get_full_name() or user.username


def build_history(plan):
    """Línea de tiempo del tratamiento: inicio, recetas, cambios, reportes del paciente y alta."""
    prescriptions = list(plan.prescriptions.select_related('doctor').order_by('created_at', 'id'))
    # La consulta guarda la receta milisegundos antes que el plan: el inicio va siempre primero.
    started = min([plan.created_at, *(item.created_at for item in prescriptions[:1])])
    events = [{
        'type': 'start',
        'date': started,
        'title': 'Inicio del tratamiento',
        'procedure': plan.procedure,
        'surgery_date': plan.surgery_date,
        'admission_reason': plan.admission_reason,
        'clinical_notes': plan.clinical_notes,
        'clinical_data': display_clinical_data(plan.clinical_procedure, plan.clinical_data),
    }]
    for prescription in prescriptions:
        events.append({
            'type': 'medication',
            'date': prescription.created_at,
            'title': 'Medicación recetada',
            'prescription_id': prescription.id,
            'medication_name': prescription.medication_name,
            'strength': prescription.strength,
            'dosage_form': prescription.dosage_form,
            'frequency': prescription.frequency,
            'duration': prescription.duration,
            'details': prescription.details,
            'is_active': prescription.is_active,
            'author': _author(prescription.doctor),
        })
    discharged = False
    for change in plan.changes.select_related('author'):
        discharged = discharged or change.kind == TreatmentChange.Kind.DISCHARGE
        events.append({
            'type': 'discharge' if change.kind == TreatmentChange.Kind.DISCHARGE else 'change',
            'date': change.created_at,
            'title': change.get_kind_display(),
            'summary': change.summary,
            'author': _author(change.author),
        })
    for report in plan.reports.order_by('created_at', 'id'):
        events.append({
            'type': 'report',
            'date': report.created_at,
            'title': 'Reporte del paciente',
            'report_id': report.id,
            'pain_level': report.pain_level,
            'alert_color': report.alert_color,
            'alert_reasons': report.alert_reasons,
            'postoperative_day': report.postoperative_day,
            'message': report.message,
            'symptoms': [item for item in report.extracted_entities if item.get('label') == 'SINTOMA'],
        })
    for visit in plan.controls.select_related('doctor'):
        events.append({
            'type': 'control',
            # Los controles solo tienen fecha: se sitúan al mediodía de su día.
            'date': timezone.make_aware(datetime.combine(visit.date, time(12, 0))),
            'title': 'Control realizado',
            'notes': visit.notes,
            'clinical_data': display_clinical_data(plan.clinical_procedure, visit.clinical_data),
            'next_control_in_days': visit.next_control_in_days,
            'author': _author(visit.doctor),
        })
    for checkin in plan.checkins.all():
        events.append({
            'type': 'care',
            'date': timezone.make_aware(datetime.combine(checkin.date, time(21, 0))),
            'title': 'Cuidados del día',
            'adherence': checkin.adherence,
            'missed': [item for item, done in checkin.items.items() if not done],
        })
    for summary in plan.summaries.all()[:5]:
        events.append({
            'type': 'summary',
            'date': summary.created_at,
            'title': 'Resumen clínico (IA)' if summary.source == 'llm' else 'Resumen clínico',
            'summary': summary.content.get('resumen', ''),
            'source': summary.source,
        })
    if not plan.is_active and not discharged:
        # Tratamientos cerrados antes de que existiera este registro.
        events.append({'type': 'discharge', 'date': plan.updated_at, 'title': 'Alta médica', 'summary': '', 'author': None})
    order = {'start': 0, 'medication': 1, 'change': 2, 'control': 3, 'report': 4, 'care': 5, 'summary': 6,
             'discharge': 7}
    return sorted(events, key=lambda event: (event['date'], order[event['type']]))

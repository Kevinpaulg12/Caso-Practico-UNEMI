"""Seguimiento del paciente: lo que cuenta cada día, clasificado por el motor local.

El paciente no «envía reportes»: conversa con el asistente y cada mensaje actualiza en silencio el
seguimiento del día (un PatientReport por tratamiento y día). El nivel de alerta lo decide siempre el
motor local (PLN + reglas por especialidad) y el paciente nunca lo ve; el odontólogo sí.
"""
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .audit import record_audit
from .models import ClinicalEvolutionSummary, PatientReport, TreatmentPlan
from .services import RISK_RANK, evaluate_patient_status, notify_primary_doctor

NO_ACTIVE_PLAN = 'Aún no tienes un tratamiento activo. Tu odontólogo debe registrarlo para iniciar el seguimiento.'
MAX_FOLLOWUP_TEXT = 2000


def latest_plan(patient):
    """Último tratamiento del paciente, vigente o cerrado (tras el alta aún puede pedir una cita)."""
    return (
        TreatmentPlan.objects.filter(patient=patient)
        .select_related('clinical_procedure', 'current_phase')
        .order_by('-is_active', '-start_date', '-created_at')
        .first()
    )


def active_plan(patient):
    """Tratamiento vigente más reciente: su última intervención marca el día de seguimiento."""
    return (
        TreatmentPlan.objects.filter(patient=patient, is_active=True)
        .select_related('clinical_procedure', 'current_phase')
        .order_by('-start_date', '-created_at')
        .first()
    )


def unique_entities(entities):
    """Una entidad por etiqueta, categoría y negación: repetir «me duele» no la duplica."""
    seen, result = set(), []
    for entity in entities:
        key = (entity.get('label'), entity.get('category') or plain_text(entity.get('text')), bool(entity.get('negated')))
        if key not in seen:
            seen.add(key)
            result.append(entity)
    return result


def plain_text(value):
    return (value or '').strip().casefold()


def _evaluate(patient, plan, pain_level, comparison, message, exclude=None):
    previous = PatientReport.objects.filter(patient=patient)
    if exclude is not None:
        previous = previous.exclude(pk=exclude)
    return evaluate_patient_status(
        pain_level, comparison or None, message, previous.order_by('-created_at').first(),
        plan.postoperative_day, protocol=plan.clinical_procedure,
    )


def _classified(evaluation):
    return {
        'nlp_severity': evaluation['severity'],
        'extracted_entities': unique_entities(evaluation['entities']),
        'risk_level': evaluation['risk_level'],
        'recommendation': evaluation['recommendation'],
        'evolution_status': evaluation['evolution_status'],
        'alert_reasons': evaluation['alert_reasons'],
    }


def _update_evolution_day(patient, report):
    """Un registro por día de calendario: el último seguimiento del día lo actualiza."""
    status_tag = 'Alerta de dolor' if report.risk_level == 'Alto' else (
        'En descenso' if report.comparison == PatientReport.Comparison.LOWER else 'Seguimiento'
    )
    values = {
        'day_label': f'Día {report.postoperative_day}',
        'eva_recorded': report.pain_level,
        'status_tag': status_tag,
        'clinical_notes': report.message[:240],
    }
    # Se toma el más reciente en lugar de exigir que sea único: los datos anteriores pueden tener varios.
    today = ClinicalEvolutionSummary.objects.filter(
        patient=patient, created_at__date=timezone.localdate(),
    ).order_by('-created_at', '-id').first()
    if today:
        ClinicalEvolutionSummary.objects.filter(pk=today.pk).update(**values)
    else:
        ClinicalEvolutionSummary.objects.create(patient=patient, **values)


def _alert_doctor(patient, plan, report):
    sent = notify_primary_doctor(patient, report)
    record_audit(patient, 'Generó una alerta de riesgo alto en su seguimiento', 'Triaje')
    if sent != 'primary':
        # Que quede constancia: la alerta no llegó (o no solo) al odontólogo tratante.
        record_audit(patient, 'Alerta sin correo del tratante' + (': avisados los demás odontólogos' if sent else ': nadie recibió el correo'), 'Triaje')
    # El odontólogo recibe además una síntesis de la evolución, preparada fuera de la respuesta.
    from .ai.summaries import refresh_summary_after_alert
    refresh_summary_after_alert(plan)


def save_patient_report(serializer, patient, plan=None):
    """Clasifica y guarda un reporte enviado por formulario (API heredada); devuelve el PatientReport."""
    plan = plan or active_plan(patient)
    if plan is None:
        raise ValidationError({'detail': NO_ACTIVE_PLAN})
    data = serializer.validated_data
    evaluation = _evaluate(patient, plan, data.get('pain_level'), data.get('comparison'), data.get('message', ''))
    report = serializer.save(
        patient=patient, doctor_notified=evaluation['doctor_notified'], postoperative_day=plan.postoperative_day,
        treatment_plan=plan, **_classified(evaluation),
    )
    _update_evolution_day(patient, report)
    record_audit(patient, 'Registró cómo se siente', 'Portal Paciente')
    if evaluation['doctor_notified']:
        _alert_doctor(patient, plan, report)
    return report


def record_daily_followup(patient, plan, texts, pain_level=None, comparison=None, report=None):
    """Crea o actualiza el seguimiento del día con todo lo que el paciente contó hoy.

    Se vuelve a clasificar con cada mensaje. El odontólogo recibe aviso solo cuando el nivel sube a
    rojo, una vez: repetir el mismo síntoma no genera alertas nuevas.
    """
    message = '. '.join(text for text in texts if text)[:MAX_FOLLOWUP_TEXT]
    if not message and pain_level is None and not comparison:
        return report
    if report is None:
        report = PatientReport(patient=patient, treatment_plan=plan, source=PatientReport.Source.CHAT)
    before = report.risk_level if report.pk else 'Bajo'
    evaluation = _evaluate(patient, plan, pain_level, comparison, message, exclude=report.pk)
    for field, value in _classified(evaluation).items():
        setattr(report, field, value)
    report.message = message
    report.pain_level = pain_level
    report.comparison = comparison or ''
    report.postoperative_day = plan.postoperative_day
    rose_to_red = report.risk_level == 'Alto' and RISK_RANK[report.risk_level] > RISK_RANK.get(before, 0)
    report.doctor_notified = report.doctor_notified or report.risk_level == 'Alto'
    report.save()
    _update_evolution_day(patient, report)
    if rose_to_red:
        _alert_doctor(patient, plan, report)
    return report

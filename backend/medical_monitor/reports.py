"""Registro de un autorreporte: lo usan el formulario del portal y el asistente conversacional.

El nivel de alerta lo decide siempre el motor local (PLN + reglas por especialidad).
"""
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .audit import record_audit
from .models import ClinicalEvolutionSummary, PatientReport, TreatmentPlan
from .services import evaluate_patient_status, notify_primary_doctor

NO_ACTIVE_PLAN = 'Aún no tienes un tratamiento activo. Tu odontólogo debe registrarlo para iniciar el seguimiento.'


def active_plan(patient):
    """Tratamiento vigente más reciente: su última intervención marca el día de seguimiento."""
    return (
        TreatmentPlan.objects.filter(patient=patient, is_active=True)
        .select_related('clinical_procedure', 'current_phase')
        .order_by('-start_date', '-created_at')
        .first()
    )


def save_patient_report(serializer, patient, plan=None):
    """Clasifica y guarda el reporte validado por `serializer`; devuelve el PatientReport."""
    plan = plan or active_plan(patient)
    if plan is None:
        raise ValidationError({'detail': NO_ACTIVE_PLAN})
    day = plan.postoperative_day
    message = serializer.validated_data.get('message', '')
    pain_level = serializer.validated_data.get('pain_level')
    comparison = serializer.validated_data.get('comparison')
    previous_report = PatientReport.objects.filter(patient=patient).order_by('-created_at').first()
    evaluation = evaluate_patient_status(
        pain_level, comparison, message, previous_report, day, protocol=plan.clinical_procedure,
    )
    report = serializer.save(
        patient=patient,
        nlp_severity=evaluation['severity'],
        extracted_entities=evaluation['entities'],
        doctor_notified=evaluation['doctor_notified'],
        risk_level=evaluation['risk_level'],
        recommendation=evaluation['recommendation'],
        evolution_status=evaluation['evolution_status'],
        alert_reasons=evaluation['alert_reasons'],
        postoperative_day=day,
        treatment_plan=plan,
    )
    status_tag = 'Alerta de dolor' if evaluation['doctor_notified'] else (
        'En descenso' if comparison == PatientReport.Comparison.LOWER else 'Seguimiento'
    )
    # Un registro por día de calendario: el último reporte del día lo actualiza. Se toma el más
    # reciente en lugar de exigir que sea único, porque los datos anteriores pueden tener varios.
    summary_values = {
        'day_label': f'Día {day}',
        'eva_recorded': report.pain_level,
        'status_tag': status_tag,
        'clinical_notes': report.message[:240],
    }
    today_summary = ClinicalEvolutionSummary.objects.filter(
        patient=patient, created_at__date=timezone.localdate(),
    ).order_by('-created_at', '-id').first()
    if today_summary:
        ClinicalEvolutionSummary.objects.filter(pk=today_summary.pk).update(**summary_values)
    else:
        ClinicalEvolutionSummary.objects.create(patient=patient, **summary_values)
    record_audit(patient, f'Envió autorreporte (EVA {report.pain_level})', 'Portal Paciente')
    if evaluation['doctor_notified']:
        notify_primary_doctor(patient, report)
        record_audit(patient, f'Generó alerta de riesgo alto (EVA {report.pain_level})', 'Triaje')
        # El odontólogo recibe además un resumen de la evolución, preparado fuera de la respuesta.
        from .ai.summaries import refresh_summary_after_alert
        refresh_summary_after_alert(plan)
    return report

"""Carga en los protocolos su intervalo de control y sus campos propios, y convierte las citas en controles.

Las citas realizadas pasan a ser controles; la cita programada más próxima de cada tratamiento activo
pasa a ser la fecha de su próximo control. Las canceladas y las no asistidas se descartan.
"""
import json
from datetime import timedelta
from pathlib import Path

from django.db import migrations
from django.utils import timezone

PROTOCOLS = Path(__file__).resolve().parent.parent / 'data' / 'protocols.json'
FIELDS = ('control_every_days', 'consultation_fields', 'medication_default', 'uses_teeth')
KIND_LABELS = {
    'control': 'Control', 'session': 'Sesión de tratamiento', 'adjustment': 'Ajuste', 'discharge': 'Valoración de alta',
}


def forwards(apps, schema_editor):
    ClinicalProcedure = apps.get_model('medical_monitor', 'ClinicalProcedure')
    TreatmentPlan = apps.get_model('medical_monitor', 'TreatmentPlan')
    Appointment = apps.get_model('medical_monitor', 'Appointment')
    ControlVisit = apps.get_model('medical_monitor', 'ControlVisit')
    Reminder = apps.get_model('medical_monitor', 'Reminder')

    for item in json.loads(PROTOCOLS.read_text(encoding='utf-8'))['protocols']:
        ClinicalProcedure.objects.filter(code=item['code']).update(**{field: item[field] for field in FIELDS})

    for appointment in Appointment.objects.filter(status='done'):
        label = KIND_LABELS.get(appointment.kind, 'Control')
        ControlVisit.objects.create(
            treatment_plan_id=appointment.treatment_plan_id, doctor_id=appointment.doctor_id,
            date=timezone.localtime(appointment.scheduled_at).date(),
            notes=f'{label}. {appointment.notes}'.strip()[:1000] if appointment.notes else label,
        )

    today = timezone.localdate()
    for plan in TreatmentPlan.objects.filter(is_active=True).select_related('clinical_procedure'):
        upcoming = (
            Appointment.objects.filter(treatment_plan=plan, status='scheduled', scheduled_at__gte=timezone.now())
            .order_by('scheduled_at').first()
        )
        if upcoming is not None:
            next_control = timezone.localtime(upcoming.scheduled_at).date()
        else:
            every = plan.clinical_procedure.control_every_days if plan.clinical_procedure_id else 0
            # Igual que el día de seguimiento: cuenta desde la última intervención.
            started = plan.start_date or timezone.localtime(plan.created_at).date()
            reference = max(filter(None, (started, plan.last_intervention_date)))
            next_control = reference + timedelta(days=every) if every else None
            # Un tratamiento antiguo no amanece con un control atrasado que nadie indicó.
            if next_control is not None and next_control < today:
                next_control = None
        if next_control is not None:
            TreatmentPlan.objects.filter(pk=plan.pk).update(next_control_date=next_control)

    # Los avisos de citas ya enviados apuntaban a citas que dejan de existir.
    Reminder.objects.filter(kind='appointment').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('medical_monitor', '0018_controls_and_protocol_forms'),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]

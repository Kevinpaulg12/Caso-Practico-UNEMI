"""Carga los protocolos de seguimiento por especialidad y da una fase a cada tratamiento existente."""
import json
from pathlib import Path

from django.db import migrations

PROTOCOLS = Path(__file__).resolve().parent.parent / 'data' / 'protocols.json'
FIELDS = (
    'name', 'specialty', 'complexity', 'monitoring_days', 'follow_up_unit', 'checkin_every_days',
    'expected_curve', 'expected_symptoms', 'alarm_symptoms', 'care_items', 'follow_up_questions', 'default_phases',
)


def seed(apps, schema_editor):
    ClinicalProcedure = apps.get_model('medical_monitor', 'ClinicalProcedure')
    TreatmentPlan = apps.get_model('medical_monitor', 'TreatmentPlan')
    TreatmentPhase = apps.get_model('medical_monitor', 'TreatmentPhase')

    data = json.loads(PROTOCOLS.read_text(encoding='utf-8'))
    for item in data['protocols']:
        values = {field: item[field] for field in FIELDS}
        procedure, created = ClinicalProcedure.objects.get_or_create(code=item['code'], defaults=values)
        if not created:
            # Los procedimientos ya existentes conservan su nombre y su curva (pudo editarlos el administrador).
            for field in FIELDS:
                if field not in ('name', 'expected_curve', 'monitoring_days', 'complexity'):
                    setattr(procedure, field, values[field])
            procedure.save()

    # Cada tratamiento existente pasa a tener su primera fase, en curso si sigue activo.
    for plan in TreatmentPlan.objects.filter(phases__isnull=True).select_related('clinical_procedure'):
        template = (plan.clinical_procedure.default_phases if plan.clinical_procedure_id else None) or [
            {'name': 'Seguimiento', 'days': 7, 'description': ''},
        ]
        first = template[0]
        phase = TreatmentPhase.objects.create(
            treatment_plan=plan, name=first['name'], description=first.get('description', '')[:240], order=1,
            planned_days=first.get('days', 7), start_date=plan.start_date,
            status='active' if plan.is_active else 'done',
        )
        TreatmentPlan.objects.filter(pk=plan.pk).update(current_phase=phase)


class Migration(migrations.Migration):

    dependencies = [
        ('medical_monitor', '0015_general_dental_followup'),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]

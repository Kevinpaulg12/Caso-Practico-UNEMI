from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def fill_doctor(apps, schema_editor):
    """Tratamientos anteriores: el autor de su primera receta o, si no tuvo, el tratante del paciente."""
    TreatmentPlan = apps.get_model('medical_monitor', 'TreatmentPlan')
    Prescription = apps.get_model('medical_monitor', 'Prescription')
    UserProfile = apps.get_model('users', 'UserProfile')
    for plan in TreatmentPlan.objects.filter(doctor__isnull=True).iterator():
        first = Prescription.objects.filter(treatment_plan_id=plan.pk, doctor__isnull=False).order_by('created_at', 'id').first()
        doctor_id = first.doctor_id if first else (
            UserProfile.objects.filter(user_id=plan.patient_id).values_list('primary_doctor_id', flat=True).first()
        )
        if doctor_id:
            TreatmentPlan.objects.filter(pk=plan.pk).update(doctor_id=doctor_id)


class Migration(migrations.Migration):

    dependencies = [
        ('medical_monitor', '0028_instruction_presets'),
        ('users', '0012_terms_shared_history_version'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='treatmentplan',
            name='doctor',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='treatments_started', to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RunPython(fill_doctor, migrations.RunPython.noop),
    ]

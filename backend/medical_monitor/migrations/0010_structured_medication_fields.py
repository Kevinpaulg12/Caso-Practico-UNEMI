from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('medical_monitor', '0009_treatmentplan_admission_reason_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='prescription',
            name='active_ingredient',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='prescription',
            name='dosage_form',
            field=models.CharField(blank=True, max_length=60),
        ),
        migrations.AddField(
            model_name='prescription',
            name='duration',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='prescription',
            name='frequency',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='prescription',
            name='medication_name',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='prescription',
            name='strength',
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name='treatmentplan',
            name='dosage_form',
            field=models.CharField(blank=True, max_length=60),
        ),
        migrations.AddField(
            model_name='treatmentplan',
            name='duration',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='treatmentplan',
            name='frequency',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='treatmentplan',
            name='medication_name',
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name='treatmentplan',
            name='strength',
            field=models.CharField(blank=True, max_length=40),
        ),
    ]

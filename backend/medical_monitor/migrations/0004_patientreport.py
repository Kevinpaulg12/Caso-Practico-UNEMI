from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('medical_monitor', '0003_prescription_extracted_entities_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PatientReport',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('pain_level', models.PositiveSmallIntegerField()),
                ('comparison', models.CharField(choices=[('lower', 'Menor'), ('same', 'Igual'), ('higher', 'Mayor')], max_length=10)),
                ('message', models.TextField(blank=True)),
                ('nlp_severity', models.CharField(default='Baja', max_length=20)),
                ('extracted_entities', models.JSONField(blank=True, default=list)),
                ('patient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='postoperative_reports', to=settings.AUTH_USER_MODEL)),
            ],
            options={'abstract': False},
        ),
    ]

"""Carga el vademécum odontológico de partida (data/vademecum.json)."""
import json
from pathlib import Path

from django.db import migrations

DATA = Path(__file__).resolve().parent.parent / 'data' / 'vademecum.json'


def seed(apps, schema_editor):
    Medication = apps.get_model('medical_monitor', 'Medication')
    for item in json.loads(DATA.read_text(encoding='utf-8'))['medications']:
        Medication.objects.update_or_create(
            generic_name=item['generic'],
            defaults={
                'brands': item['brands'], 'group': item['group'], 'presentations': item['presentations'],
                'frequencies': item['frequencies'], 'default_frequency': item['default_frequency'],
                'duration_days': item['duration_days'], 'with_food': item['with_food'],
                'indications': item['indications'], 'mechanism': item['mechanism'],
                'common_effects': item['common_effects'], 'warning_signs': item['warning_signs'],
                'prescription_required': item['prescription_required'], 'source': 'clinica', 'sheet_ready': True,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ('medical_monitor', '0022_vademecum'),
    ]

    operations = [
        migrations.RunPython(seed, migrations.RunPython.noop),
    ]

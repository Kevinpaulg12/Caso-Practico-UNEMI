from django.db import migrations

NEW_VERSION = '2026-11-ia'


def require_new_consent(apps, schema_editor):
    """Los términos ahora incluyen el uso de IA: los pacientes que aceptaron la versión anterior vuelven a aceptarlos."""
    User = apps.get_model('users', 'User')
    User.objects.filter(role='PAT').exclude(terms_version=NEW_VERSION).update(must_accept_terms=True)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0007_terms_consent_and_title_case'),
    ]

    operations = [
        migrations.RunPython(require_new_consent, migrations.RunPython.noop),
    ]

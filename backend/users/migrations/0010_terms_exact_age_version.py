from django.db import migrations

NEW_VERSION = '2026-11-edad'


def require_new_consent(apps, schema_editor):
    """La IA pasa a recibir la edad en años en lugar de un rango: los pacientes vuelven a aceptar los términos."""
    User = apps.get_model('users', 'User')
    User.objects.filter(role='PAT').exclude(terms_version=NEW_VERSION).update(must_accept_terms=True)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0009_terms_gemini_version'),
    ]

    operations = [
        migrations.RunPython(require_new_consent, migrations.RunPython.noop),
    ]

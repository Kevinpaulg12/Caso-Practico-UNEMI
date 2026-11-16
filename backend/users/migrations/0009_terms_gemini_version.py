from django.db import migrations

NEW_VERSION = '2026-11-gemini'


def require_new_consent(apps, schema_editor):
    """El proveedor de IA cambió a Google (Gemini): los pacientes vuelven a aceptar los términos."""
    User = apps.get_model('users', 'User')
    User.objects.filter(role='PAT').exclude(terms_version=NEW_VERSION).update(must_accept_terms=True)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0008_terms_ai_version'),
    ]

    operations = [
        migrations.RunPython(require_new_consent, migrations.RunPython.noop),
    ]

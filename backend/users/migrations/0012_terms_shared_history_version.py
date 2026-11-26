from django.db import migrations

NEW_VERSION = '2026-11-historia'


def require_new_consent(apps, schema_editor):
    """La historia clínica pasa a compartirse entre los odontólogos de la clínica: se vuelve a aceptar."""
    User = apps.get_model('users', 'User')
    User.objects.filter(role='PAT').exclude(terms_version=NEW_VERSION).update(must_accept_terms=True)


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0011_credentials_delivery'),
    ]

    operations = [
        migrations.RunPython(require_new_consent, migrations.RunPython.noop),
    ]

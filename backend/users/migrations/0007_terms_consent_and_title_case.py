from django.db import migrations, models


def title_case(value):
    return ' '.join((value or '').split()).title()


def forwards(apps, schema_editor):
    User = apps.get_model('users', 'User')
    for user in User.objects.only('pk', 'first_name', 'last_name', 'role', 'terms_accepted_at'):
        first_name, last_name = title_case(user.first_name), title_case(user.last_name)
        # Antes el odontólogo marcaba una casilla en nombre del paciente: ese consentimiento
        # no lo dio el paciente, así que se le pide en su próximo acceso.
        must_accept = user.role == 'PAT' and user.terms_accepted_at is None
        User.objects.filter(pk=user.pk).update(
            first_name=first_name, last_name=last_name, must_accept_terms=must_accept,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0006_requirements_alignment'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='must_accept_terms',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='user',
            name='terms_accepted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='terms_version',
            field=models.CharField(blank=True, max_length=20),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]

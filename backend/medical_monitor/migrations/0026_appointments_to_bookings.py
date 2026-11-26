"""Las solicitudes de cita del sistema anterior pasan a citas reservadas o canceladas.

Antes el paciente pedía un día y una franja y el odontólogo confirmaba la hora. Ahora el paciente
reserva un turno libre de la agenda del odontólogo:
- confirmada o reprogramada (con hora) → reservada, con su odontólogo y su hora;
- pendiente sin hora → cancelada, con una nota para que reserve un turno en el chat.
"""
from django.db import migrations

PENDING_NOTE = 'Solicitud del sistema anterior sin hora asignada: reserva un turno libre desde el asistente.'


def convert(apps, schema_editor):
    AppointmentRequest = apps.get_model('medical_monitor', 'AppointmentRequest')
    UserProfile = apps.get_model('users', 'UserProfile')
    primary = dict(UserProfile.objects.values_list('user_id', 'primary_doctor_id'))
    taken = set()
    for item in AppointmentRequest.objects.order_by('created_at', 'id'):
        doctor_id = item.handled_by_id or primary.get(item.patient_id)
        if item.status in ('confirmed', 'rescheduled') and item.confirmed_at and doctor_id:
            key = (doctor_id, item.confirmed_at)
            if key not in taken:
                taken.add(key)
                item.status, item.doctor_id, item.starts_at = 'booked', doctor_id, item.confirmed_at
                item.save(update_fields=['status', 'doctor', 'starts_at'])
                continue
        if item.status not in ('cancelled',):
            item.status = 'cancelled'
            item.note = (item.note or PENDING_NOTE)[:300]
        item.doctor_id = item.doctor_id or doctor_id
        item.save(update_fields=['status', 'note', 'doctor'])


class Migration(migrations.Migration):

    dependencies = [
        ('medical_monitor', '0025_doctor_agenda'),
        ('users', '0012_terms_shared_history_version'),
    ]

    operations = [
        migrations.RunPython(convert, migrations.RunPython.noop),
    ]

"""Correo de las 06:30 con la agenda del día de cada odontólogo: quién viene, a qué hora y para qué."""
import logging
from datetime import time

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from .models import AppointmentRequest, Reminder

logger = logging.getLogger(__name__)
SEND_FROM = time(6, 30)


def agenda_lines(appointments):
    lines = []
    for item in appointments:
        name = item.patient.get_full_name() or item.patient.username
        plan = item.treatment_plan
        if item.kind == AppointmentRequest.Kind.FOLLOWUP and plan:
            purpose = f'Seguimiento de {(plan.procedure or plan.title).lower()}'
        else:
            purpose = 'Valoración de un tratamiento nuevo'
        line = f'{timezone.localtime(item.starts_at):%H:%M} · {name} · {purpose}'
        if item.reason:
            line += f'\n        Motivo que escribió: {item.reason}'
        lines.append(line)
    return lines


def send_daily_agendas(now=None):
    """Envía (una sola vez al día, desde las 06:30) la agenda de cada odontólogo con citas hoy."""
    now = timezone.localtime(now or timezone.now())
    if now.time() < SEND_FROM:
        return 0
    today = now.date()
    booked = (
        AppointmentRequest.objects.filter(status=AppointmentRequest.Status.BOOKED, starts_at__date=today)
        .select_related('doctor', 'patient', 'treatment_plan').order_by('starts_at')
    )
    by_doctor = {}
    for item in booked:
        if item.doctor and item.doctor.email:
            by_doctor.setdefault(item.doctor, []).append(item)
    sent = 0
    for doctor, items in by_doctor.items():
        reminder, created = Reminder.objects.get_or_create(
            kind=Reminder.Kind.AGENDA, key=f'agenda:{doctor.pk}:{today.isoformat()}', defaults={'user': doctor},
        )
        if not created:
            continue
        followups = sum(item.kind == AppointmentRequest.Kind.FOLLOWUP for item in items)
        body = '\n'.join([
            f'Buenos días, Dr(a). {doctor.get_full_name() or doctor.username}.',
            f'Hoy tienes {len(items)} {"cita" if len(items) == 1 else "citas"}: '
            f'{followups} de seguimiento y {len(items) - followups} de valoración de un tratamiento nuevo.',
            '',
            *agenda_lines(items),
            '',
            f'Tu agenda completa: {settings.PORTAL_URL}/panel-doctor/horario',
        ])
        try:
            send_mail(f'DentalSense: tu agenda de hoy ({len(items)})', body, settings.DEFAULT_FROM_EMAIL, [doctor.email])
            sent += 1
        except Exception:  # noqa: BLE001 - se reintenta en la siguiente pasada del programador
            logger.exception('No se pudo enviar la agenda de %s', doctor.username)
            reminder.delete()
    return sent

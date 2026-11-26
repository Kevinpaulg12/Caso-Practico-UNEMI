"""Agenda en línea del odontólogo: turnos libres, reservas por orden de llegada, cancelaciones y bloqueos.

No hay secretaria ni confirmación manual. El odontólogo publica su horario semanal (DoctorSchedule +
WorkingHours) y bloquea los días u horas en que no atiende (TimeOff). El paciente reserva en el chat un
turno libre; el primero que lo toma se lo queda (restricción única en la base de datos).
"""
import threading
from datetime import datetime, timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.formats import date_format

from .models import AppointmentRequest, DoctorSchedule, TimeOff, TreatmentPlan

LONG_DATE = 'l j \\d\\e F'
CLINIC_PHONE = '04 270 0000'


class SlotTaken(Exception):
    """El turno ya no está libre (otro paciente lo reservó, o el odontólogo lo bloqueó)."""


def describe(when):
    local = timezone.localtime(when)
    return f'{date_format(local, LONG_DATE)} a las {local:%H:%M}'


def name_of(user):
    return (user.get_full_name() or user.username) if user else ''


def _send(recipients, subject, body):
    recipients = [address for address in recipients if address]
    if not recipients:
        return

    def send():
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, recipients, fail_silently=True)

    if settings.EMAIL_IN_BACKGROUND:
        transaction.on_commit(lambda: threading.Thread(target=send, daemon=True).start())
    else:
        transaction.on_commit(send)


def _notify_patient(patient, subject, body):
    _send([patient.email], subject, f'{body}\n\nIngresa a tu portal de DentalSense para más detalles.')


# --- Disponibilidad ----------------------------------------------------------------------------------

def schedule_of(doctor):
    """Agenda del odontólogo si tiene un horario publicado; None si no atiende en línea."""
    if doctor is None:
        return None
    schedule = DoctorSchedule.objects.filter(doctor=doctor).first()
    if schedule is None or not doctor.working_hours.exists():
        return None
    return schedule


def bookable_doctors(preferred=None):
    """Odontólogos activos con agenda en línea; el preferido (su odontólogo anterior) va primero."""
    from users.models import User

    doctors = [
        doctor for doctor in User.objects.filter(role=User.Roles.DOCTOR, is_active=True).order_by('first_name', 'last_name', 'username')
        if schedule_of(doctor) is not None
    ]
    doctors.sort(key=lambda doctor: doctor != preferred)
    return doctors


def bookable_days(schedule, today=None):
    today = today or timezone.localdate()
    return today, today + timedelta(days=schedule.max_days_ahead)


def _aware(day, moment):
    return timezone.make_aware(datetime.combine(day, moment))


def _overlaps(start, end, other_start, other_end):
    return start < other_end and other_start < end


def free_slots(doctor, day, schedule=None, now=None):
    """Inicios de los turnos libres de ese día (datetimes con zona), en orden."""
    schedule = schedule or schedule_of(doctor)
    if schedule is None:
        return []
    first, last = bookable_days(schedule)
    if not first <= day <= last:
        return []
    now = now or timezone.now()
    step = timedelta(minutes=schedule.slot_minutes)
    blocks = list(TimeOff.objects.filter(doctor=doctor, date=day))
    if any(block.all_day for block in blocks):
        return []
    blocked = [(_aware(day, block.start), _aware(day, block.end)) for block in blocks]
    taken = [
        (item.starts_at, item.ends_at)
        for item in AppointmentRequest.objects.filter(
            doctor=doctor, status=AppointmentRequest.Status.BOOKED, starts_at__date=day,
        )
    ]
    slots = []
    for hours in doctor.working_hours.filter(weekday=day.weekday()):
        start, end = _aware(day, hours.start), _aware(day, hours.end)
        while start + step <= end:
            finish = start + step
            busy = any(_overlaps(start, finish, *span) for span in blocked + taken)
            if start > now and not busy:
                slots.append(start)
            start = finish
    return sorted(slots)


def free_days(doctor, limit=5, schedule=None, after=None):
    """Próximos días con al menos un turno libre (hasta `limit`)."""
    schedule = schedule or schedule_of(doctor)
    if schedule is None:
        return []
    first, last = bookable_days(schedule)
    day = max(first, after or first)
    found = []
    while day <= last and len(found) < limit:
        if free_slots(doctor, day, schedule):
            found.append(day)
        day += timedelta(days=1)
    return found


def upcoming_booking(patient):
    return (
        AppointmentRequest.objects.filter(
            patient=patient, status=AppointmentRequest.Status.BOOKED, starts_at__gte=timezone.now(),
        )
        .select_related('doctor')
        .order_by('starts_at')
        .first()
    )


# --- Reservar, cancelar y bloquear ---------------------------------------------------------------------

def book(patient, plan, doctor, starts_at, reason=''):
    """Reserva un turno libre. Lanza SlotTaken si ya no está disponible."""
    try:
        with transaction.atomic():
            # Bloquea la agenda del odontólogo: las reservas simultáneas se atienden de una en una.
            schedule = DoctorSchedule.objects.select_for_update().filter(doctor=doctor).first()
            if schedule is None or starts_at not in free_slots(doctor, timezone.localtime(starts_at).date(), schedule):
                raise SlotTaken
            active = plan is not None and plan.is_active
            local = timezone.localtime(starts_at)
            item = AppointmentRequest.objects.create(
                patient=patient, doctor=doctor, treatment_plan=plan, starts_at=starts_at,
                duration_minutes=schedule.slot_minutes,
                # Seguimiento si tiene un tratamiento en curso; si no, el odontólogo valora uno nuevo.
                kind=AppointmentRequest.Kind.FOLLOWUP if active else AppointmentRequest.Kind.ASSESSMENT,
                preferred_date=local.date(),
                preferred_period=AppointmentRequest.Period.MORNING if local.hour < 13 else AppointmentRequest.Period.AFTERNOON,
                reason=reason[:300], confirmed_at=starts_at,
            )
            if active:
                # La cita es el próximo control: el paciente recibe los recordatorios de siempre.
                TreatmentPlan.objects.filter(pk=plan.pk).update(next_control_date=local.date())
    except IntegrityError as error:
        raise SlotTaken from error
    when = describe(starts_at)
    _notify_patient(patient, 'DentalSense: tu cita quedó reservada',
                    f'Tu cita con Dr(a). {name_of(doctor)} quedó reservada para el {when}.\n'
                    f'Si no puedes asistir, cancélala desde el asistente para liberar el turno.')
    _send([doctor.email], f'DentalSense: nueva cita el {when}',
          f'{name_of(patient)} reservó una cita ({item.get_kind_display().lower()}) para el {when}.'
          + (f'\nMotivo: {item.reason}' if item.reason else ''))
    return item


def cancel(item, by, reason=''):
    """Cancela una cita reservada y avisa a la otra parte."""
    if item.status != AppointmentRequest.Status.BOOKED:
        return item
    item.status = AppointmentRequest.Status.CANCELLED
    item.handled_by = by
    item.note = reason[:300]
    item.save(update_fields=['status', 'handled_by', 'note', 'updated_at'])
    when = describe(item.starts_at) if item.starts_at else long_day(item.preferred_date)
    if by is None or by.pk != item.patient_id:
        _notify_patient(item.patient, 'DentalSense: tu cita fue cancelada',
                        f'Tu cita del {when} fue cancelada.' + (f' Motivo: {reason}' if reason else '')
                        + f'\nPuedes reservar otro turno desde el asistente o llamar a la clínica al {CLINIC_PHONE}.')
    if item.doctor and (by is None or by.pk != item.doctor_id):
        _send([item.doctor.email], f'DentalSense: cita cancelada ({when})',
              f'{name_of(item.patient)} canceló su cita del {when}. El turno quedó libre.')
    return item


def long_day(value):
    return date_format(value, LONG_DATE)


@transaction.atomic
def block_time(doctor, day, start=None, end=None, reason=''):
    """Bloquea un día (o unas horas) de la agenda y cancela las citas que choquen. Devuelve (bloqueo, canceladas)."""
    block = TimeOff.objects.create(doctor=doctor, date=day, start=start, end=end, reason=reason[:200])
    booked = AppointmentRequest.objects.select_related('patient', 'doctor').filter(
        doctor=doctor, status=AppointmentRequest.Status.BOOKED, starts_at__date=day,
    )
    affected = [
        item for item in booked
        if block.all_day or _overlaps(item.starts_at, item.ends_at, _aware(day, start), _aware(day, end))
    ]
    message = 'Tu odontólogo no podrá atender en ese horario.' + (f' {reason}' if reason else '')
    for item in affected:
        cancel(item, doctor, message)
    return block, len(affected)


def mark_attended(patient, day):
    """El control o la consulta registrados ese día cumplen la cita reservada."""
    AppointmentRequest.objects.filter(
        patient=patient, status=AppointmentRequest.Status.BOOKED, starts_at__date=day,
    ).update(status=AppointmentRequest.Status.ATTENDED)

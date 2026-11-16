"""Recordatorios del seguimiento: control próximo o atrasado, reporte pendiente y cuidados del día.

Se muestran en el portal del paciente y, si tiene correo, el comando `send_reminders` los envía una
sola vez (Reminder evita repetirlos).
"""
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from django.utils.formats import date_format

from .models import Reminder, TreatmentPlan

CARE_REMINDER_HOUR = 18
# Días de antelación con que se avisa de un control.
CONTROL_NOTICE_DAYS = 3
CONTACT = 'Comunícate con el consultorio para confirmar tu turno.'


def control_reminder(plan, today):
    """Aviso del próximo control: unos días antes, el mismo día y, si se pasó, una vez por semana."""
    due = plan.next_control_date
    if due is None:
        return None
    days_left = (due - today).days
    if days_left > CONTROL_NOTICE_DAYS:
        return None
    treatment = (plan.procedure or plan.title).lower()
    when = date_format(due, 'l j \\d\\e F')
    if days_left > 0:
        stage, message = 'soon', f'Tu control de {treatment} toca el {when}. {CONTACT}'
    elif days_left == 0:
        stage, message = 'today', f'Hoy te toca tu control de {treatment}. {CONTACT}'
    else:
        stage = f'late{-days_left // 7}'
        message = f'Tu control de {treatment} debía ser el {when}. Comunícate con el consultorio para ponerte al día.'
    return {'kind': Reminder.Kind.CONTROL, 'key': f'control:{plan.pk}:{due.isoformat()}:{stage}', 'text': message}


def pending_for_plan(plan, now=None):
    """Recordatorios vigentes de un tratamiento activo: [{kind, key, text}]."""
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    today = local_now.date()
    items = []
    control = control_reminder(plan, today)
    if control:
        items.append(control)

    every = getattr(plan.clinical_procedure, 'checkin_every_days', 1) or 1
    last_report = plan.reports.order_by('-created_at').first()
    reference = max(filter(None, (
        timezone.localtime(last_report.created_at).date() if last_report else None,
        plan.last_intervention_date, plan.surgery_date,
    )))
    if (today - reference).days >= every:
        items.append({
            'kind': Reminder.Kind.REPORT,
            'key': f'report:{plan.pk}:{today.isoformat()}',
            'text': 'Hoy te toca contarle a tu odontólogo cómo te sientes: abre el asistente y envía tu reporte.',
        })

    care_items = getattr(plan.clinical_procedure, 'care_items', None) or []
    if care_items and local_now.hour >= CARE_REMINDER_HOUR and not plan.checkins.filter(date=today).exists():
        items.append({
            'kind': Reminder.Kind.CARE,
            'key': f'care:{plan.pk}:{today.isoformat()}',
            'text': 'Aún no marcas tus cuidados de hoy. Hazlo antes de dormir.',
        })
    return items


def send_pending(now=None):
    """Envía por correo los recordatorios que aún no se enviaron. Devuelve cuántos se enviaron."""
    sent = 0
    plans = TreatmentPlan.objects.filter(is_active=True).exclude(patient__email='').select_related(
        'patient', 'clinical_procedure',
    )
    for plan in plans:
        for item in pending_for_plan(plan, now):
            reminder, created = Reminder.objects.get_or_create(
                kind=item['kind'], key=item['key'], defaults={'user': plan.patient},
            )
            if not created:
                continue
            send_mail(
                subject='DentalSense: recordatorio de tu tratamiento',
                message=f'{item["text"]}\n\nIngresa a tu portal de DentalSense para más detalles.',
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[plan.patient.email],
                fail_silently=True,
            )
            sent += 1
    return sent


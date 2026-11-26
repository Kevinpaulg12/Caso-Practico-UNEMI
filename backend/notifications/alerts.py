"""Correo al odontólogo asignado cuando un paciente registra una alerta roja."""
import threading

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction


def notify_primary_doctor(patient, report):
    """Avisa por correo al médico asignado; el panel muestra la alerta aunque no tenga correo."""
    profile = getattr(patient, 'profile', None)
    doctor = profile.primary_doctor if profile else None
    if not doctor or not doctor.email:
        return False

    def send():
        send_mail(
            'DentalSense: alerta roja',
            f'{patient.get_full_name() or patient.username} registró EVA {report.pain_level}. '
            'Revisa su ficha en el panel clínico.',
            settings.DEFAULT_FROM_EMAIL,
            [doctor.email],
            fail_silently=True,
        )

    # El correo sale después de responder al paciente: un servidor SMTP lento no debe frenar el reporte.
    if settings.EMAIL_IN_BACKGROUND:
        transaction.on_commit(lambda: threading.Thread(target=send, daemon=True).start())
    else:
        transaction.on_commit(send)
    return True


def email_doctor_on_high_risk(sender, patient, report, **kwargs):
    """Receptor de la señal `high_risk_report` del núcleo."""
    # Doble control: aunque la app esté instalada, la bandera permite apagar la característica.
    if not settings.ENABLE_NOTIFICATIONS:
        return False
    return notify_primary_doctor(patient, report)

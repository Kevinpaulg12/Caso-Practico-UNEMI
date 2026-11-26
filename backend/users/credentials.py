"""Envío formal de las credenciales temporales del paciente por correo institucional (SMTP).

Las credenciales ya no se muestran en pantalla ni se entregan por canales informales: se envían al
correo del paciente después de guardar la ficha, en segundo plano, y el resultado queda registrado.
"""
import logging
import secrets
import threading

from django.conf import settings
from django.core.mail import send_mail
from django.db import close_old_connections, transaction
from django.utils import timezone

from .models import UserProfile

logger = logging.getLogger(__name__)


def temporary_password():
    return f'Paciente-{secrets.token_urlsafe(9)}!'


def mask_email(email):
    """«ana.ruiz@correo.ec» -> «a***@correo.ec»: confirma el destino sin exponer el correo completo."""
    local, _, domain = (email or '').partition('@')
    return f'{local[:1]}***@{domain}' if local and domain else ''


def _message(user, password, doctor):
    doctor_name = (doctor.get_full_name() or doctor.username) if doctor else 'tu odontólogo'
    return (
        f'Hola, {user.first_name or user.username}:\n\n'
        f'{doctor_name} registró tu ficha en DentalSense, la plataforma de seguimiento de tu tratamiento odontológico.\n\n'
        f'Usuario: {user.username}\n'
        f'Contraseña temporal: {password}\n\n'
        f'Ingresa en {settings.PORTAL_URL}/login. En tu primer acceso deberás cambiar la contraseña y aceptar '
        'los términos de uso de tus datos.\n\n'
        'Si no reconoces este registro, comunícate con la clínica al 04 270 0000.\n'
        'Este es un mensaje automático: no lo respondas.'
    )


def _record(user_id, error=''):
    UserProfile.objects.filter(user_id=user_id).update(
        credentials_sent_at=None if error else timezone.now(), credentials_error=error[:200],
    )


def send_credentials(user, password, doctor=None):
    """Envía las credenciales cuando se confirme la transacción, sin hacer esperar al odontólogo."""
    body = _message(user, password, doctor)

    def send():
        try:
            send_mail('DentalSense: tus credenciales de acceso', body, settings.DEFAULT_FROM_EMAIL, [user.email])
        except Exception as error:  # SMTP caído o rechazado: queda registrado para reenviarlas.
            logger.warning('No se pudieron enviar las credenciales de %s: %s', user.username, error)
            _record(user.pk, f'No se pudo enviar el correo: {error.__class__.__name__}')
        else:
            _record(user.pk)
        finally:
            if settings.EMAIL_IN_BACKGROUND:
                close_old_connections()

    def start():
        if settings.EMAIL_IN_BACKGROUND:
            threading.Thread(target=send, daemon=True).start()
        else:
            send()

    UserProfile.objects.filter(user_id=user.pk).update(credentials_sent_at=None, credentials_error='')
    transaction.on_commit(start)


@transaction.atomic
def resend_credentials(user, doctor):
    """Genera otra contraseña temporal (la anterior deja de valer) y la envía de nuevo."""
    password = temporary_password()
    user.set_password(password)
    user.must_change_password = True
    user.save(update_fields=['password', 'must_change_password'])
    send_credentials(user, password, doctor)


def credentials_status(user):
    profile = getattr(user, 'profile', None)
    return {
        'email': mask_email(user.email),
        'sent_at': getattr(profile, 'credentials_sent_at', None),
        'error': getattr(profile, 'credentials_error', ''),
    }

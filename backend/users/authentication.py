"""Expiración de la sesión por inactividad (RNF01).

Cada petición del usuario renueva su última actividad. Las peticiones automáticas de la
interfaz (cabecera X-Background-Request) no la renuevan, para que una pantalla abierta
no mantenga viva una sesión desatendida.
"""
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

# Evita escribir en la base en cada petición; la precisión del límite es de 15 segundos.
TOUCH_INTERVAL = timedelta(seconds=15)
IDLE_MESSAGE = 'Tu sesión se cerró por inactividad. Inicia sesión nuevamente.'


class SessionIdle(AuthenticationFailed):
    default_code = 'session_idle'

    def __init__(self):
        super().__init__({'detail': IDLE_MESSAGE, 'code': self.default_code})


def idle_limit():
    return timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES)


def ensure_not_idle(user):
    if user.last_activity and timezone.now() - user.last_activity > idle_limit():
        raise SessionIdle()


def touch(user, force=False):
    now = timezone.now()
    if force or not user.last_activity or now - user.last_activity >= TOUCH_INTERVAL:
        type(user).objects.filter(pk=user.pk).update(last_activity=now)
        user.last_activity = now


class IdleAwareJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        ensure_not_idle(user)
        if request.headers.get('X-Background-Request') != '1':
            touch(user)
        return user, token

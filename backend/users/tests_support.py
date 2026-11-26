"""Ayudas de las pruebas de usuarios."""
import re

from django.core import mail


def password_from_mail():
    """La contraseña temporal del último correo de credenciales: la API ya no la devuelve."""
    body = mail.outbox[-1].body
    return re.search(r'Contraseña temporal: (\S+)', body).group(1)

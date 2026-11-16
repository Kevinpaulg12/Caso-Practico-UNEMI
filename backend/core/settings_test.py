"""Configuración para ejecutar las pruebas sin PostgreSQL ni datos reales.

Uso: python manage.py test --settings=core.settings_test
"""
import os

os.environ.setdefault('SECRET_KEY', 'solo-para-pruebas')

from .settings import *  # noqa: E402,F401,F403

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    'DEFAULT_THROTTLE_RATES': {'login': '10000/min', 'assistant': '10000/min', 'ai': '10000/min'},
}
EMAIL_IN_BACKGROUND = False
# Sin caché de catálogos: cada prueba ve exactamente los datos que crea.
DATA_CACHE_SECONDS = 0
# Las pruebas nunca llaman al modelo real: las que prueban la IA simulan el cliente.
AI_ENABLED = False
AI_IN_BACKGROUND = False

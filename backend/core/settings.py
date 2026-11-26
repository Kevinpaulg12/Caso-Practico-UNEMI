from pathlib import Path
import environ
from corsheaders.defaults import default_headers
import os

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Inicializar django-environ
env = environ.Env(
    # Establecer valores por defecto y tipos
    DEBUG=(bool, False)
)

# En Docker, las variables ya están en el entorno gracias a docker-compose.yml.
# Sin embargo, esta línea lee un archivo .env si ejecutas el proyecto por fuera de Docker.
for env_file in (BASE_DIR / '.env', BASE_DIR.parent / '.env'):
    if env_file.exists():
        environ.Env.read_env(str(env_file))

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/6.1/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
# SECURITY WARNING: don't run with debug turned on in production!
# Tomará el valor de la variable de entorno, y si no existe, será False.
DEBUG = env('DEBUG')

# La clave insegura solo se admite en desarrollo; fuera de él, SECRET_KEY es obligatoria.
SECRET_KEY = env('SECRET_KEY', default='django-insecure-solo-desarrollo') if DEBUG else env('SECRET_KEY')

# Cuando DEBUG es False en producción, necesitas definir los dominios permitidos
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=['localhost', '127.0.0.1', '[::1]'])


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Apps locales
    'users',
    'core',
    'medical_monitor',
    'corsheaders',  
    'rest_framework',
]

MIDDLEWARE = [
    # Mide cada petición (cabecera Server-Timing) y registra las lentas.
    'core.middleware.RequestTimingMiddleware',
    'django.middleware.security.SecurityMiddleware',
    # Comprime las respuestas JSON de más de 200 bytes (listados, historial, catálogo).
    'django.middleware.gzip.GZipMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'


# Database
# https://docs.djangoproject.com/en/6.1/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME', default='mi_base_datos'),
        'USER': env('DB_USER', default='admin'),
        'PASSWORD': env('DB_PASSWORD', default='admin_password'),
        'HOST': env('DB_HOST', default='localhost'), # 'db' en docker, 'localhost' si corres python puro
        'PORT': env('DB_PORT', default='5432'),
        # Reutiliza la conexión entre peticiones en lugar de abrir una nueva cada vez; en producción,
        # detrás de un pool (PgBouncer o el del proveedor), este valor se mantiene.
        'CONN_MAX_AGE': env.int('DB_CONN_MAX_AGE', default=60),
        'CONN_HEALTH_CHECKS': True,
    }
}

# Caché: Redis si se define CACHE_URL (compartida entre instancias); si no, la memoria del proceso.
# También la usan los límites de uso (throttling) del inicio de sesión y de la IA.
CACHE_URL = env('CACHE_URL', default='')
if CACHE_URL:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': CACHE_URL,
            'KEY_PREFIX': 'dentalsense',
            # Un Redis lento o caído no debe colgar la petición.
            'OPTIONS': {'socket_connect_timeout': 1, 'socket_timeout': 1},
        }
    }
else:
    CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
# Tiempo de vida de los catálogos en caché (protocolos, guías de medicación, umbrales). 0 = sin caché.
DATA_CACHE_SECONDS = env.int('DATA_CACHE_SECONDS', default=600)
# Las peticiones que tardan más quedan registradas con su ruta y número de consultas.
SLOW_REQUEST_MS = env.int('SLOW_REQUEST_MS', default=800)


# Password validation
# https://docs.djangoproject.com/en/6.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.1/topics/i18n/

LANGUAGE_CODE = 'es'

TIME_ZONE = 'America/Guayaquil'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.1/howto/static-files/

STATIC_URL = 'static/'


# Email
# https://docs.djangoproject.com/en/6.1/topics/email/#topic-email-configuration

# Con EMAIL_HOST se usa el SMTP institucional; sin él, los correos se muestran en la consola (desarrollo).
EMAIL_HOST = env('EMAIL_HOST', default='')
EMAIL_PORT = env.int('EMAIL_PORT', default=587)
EMAIL_HOST_USER = env('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD', default='')
EMAIL_USE_TLS = env.bool('EMAIL_USE_TLS', default=True)
EMAIL_USE_SSL = env.bool('EMAIL_USE_SSL', default=False)
EMAIL_BACKEND = env('EMAIL_BACKEND', default=(
    'django.core.mail.backends.smtp.EmailBackend' if EMAIL_HOST else 'django.core.mail.backends.console.EmailBackend'
))
EMAIL_IN_BACKGROUND = True
# Un servidor de correo que no responde no puede bloquear al sistema.
EMAIL_TIMEOUT = env.int('EMAIL_TIMEOUT', default=10)
DEFAULT_FROM_EMAIL = env('DEFAULT_FROM_EMAIL', default='alertas@dentalsense.example')
# Dirección del portal que se indica en los correos (credenciales, recordatorios).
PORTAL_URL = env('PORTAL_URL', default='http://localhost:5173').rstrip('/')

# IA generativa (asistente, resúmenes y explicaciones). El triaje no depende de ella: sin clave o con
# AI_ENABLED=False el sistema usa sus alternativas locales. Proveedor: Google Gemini (google-genai).
GEMINI_API_KEY = env('GEMINI_API_KEY', default='')
AI_ENABLED = env.bool('AI_ENABLED', default=bool(GEMINI_API_KEY))
# Flash-lite: el más rápido medido con la clave del proyecto (primer texto en ~1,6 s), adecuado para conversar.
AI_MODEL = env('AI_MODEL', default='gemini-3.5-flash-lite')
AI_TIMEOUT_SECONDS = env.float('AI_TIMEOUT_SECONDS', default=20.0)
# Opcional: tokens de razonamiento, solo en los modelos que lo admiten (vacío = lo decide el modelo).
# gemini-4-hydrogen no lo admite.
AI_THINKING_BUDGET = env.int('AI_THINKING_BUDGET', default=None)
# Al llegar una alerta roja se prepara un resumen para el odontólogo en segundo plano.
AI_SUMMARY_ON_ALERT = env.bool('AI_SUMMARY_ON_ALERT', default=True)
AI_IN_BACKGROUND = True

DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'
AUTH_USER_MODEL = 'users.User'
# Permitir que React (Vite) consuma la API
CORS_ALLOW_HEADERS = (*default_headers, 'x-background-request')

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
]

REST_FRAMEWORK = {
    # Todos los listados van paginados; el cliente puede pedir hasta 100 por página (?page_size=).
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.StandardPagination',
    'PAGE_SIZE': 10,
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'users.authentication.IdleAwareJWTAuthentication',
    ),
    # Ahora TODO el sistema está bloqueado por defecto
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
        'users.permissions.TermsAccepted',
        'users.permissions.PasswordChangeCompleted',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/min',
        # Acota el gasto en el modelo de lenguaje por usuario.
        'assistant': '30/min',
        'ai': '20/hour',
    },
}

# Configuración de JWT (Opcional pero recomendada)
from datetime import timedelta
# RNF01: la sesión caduca tras este tiempo sin peticiones del usuario.
SESSION_IDLE_TIMEOUT_MINUTES = env.int('SESSION_IDLE_TIMEOUT_MINUTES', default=5)

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=SESSION_IDLE_TIMEOUT_MINUTES),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=1),
    'AUTH_HEADER_TYPES': ('Bearer',),
    # Cambiar la contraseña invalida los tokens emitidos antes.
    'CHECK_REVOKE_TOKEN': True,
}
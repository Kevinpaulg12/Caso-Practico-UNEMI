"""Único punto de acceso al modelo de lenguaje (Google Gemini, SDK oficial `google-genai`).

Cada llamada pide una salida JSON con el esquema de un modelo Pydantic y la valida al recibirla, y
queda registrada en AIInteraction. Cualquier fallo (IA desactivada, sin clave, tiempo agotado, error
del servicio, bloqueo de seguridad o salida incompleta) se convierte en AIUnavailable para que quien
llama use su alternativa local: la IA nunca es imprescindible.

El prompt de sistema es estable (reglas + catálogo de protocolos): los modelos Gemini lo reutilizan
con su caché implícita, y los tokens leídos de caché se registran.
"""
import json
import logging
import re
import time

import httpx
import pydantic
from django.conf import settings
from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from ..models import AIInteraction

try:  # google-genai 3.x hace las peticiones con httpx2; versiones anteriores, con httpx
    import httpx2
except ImportError:  # pragma: no cover
    httpx2 = httpx

logger = logging.getLogger(__name__)
TIMEOUT_ERRORS = (httpx.TimeoutException, httpx2.TimeoutException)
NETWORK_ERRORS = (httpx.HTTPError, httpx2.HTTPError)

# Motivos de fin que significan que el modelo no dio una respuesta utilizable por seguridad.
BLOCKED = {'SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'}
# Los modelos con razonamiento gastan parte de max_output_tokens pensando: se deja margen.
THINKING_HEADROOM = 4096
_client = None


class AIUnavailable(Exception):
    """El modelo no dio un resultado utilizable; se usa la alternativa local."""


def ai_enabled():
    return bool(settings.AI_ENABLED and settings.GEMINI_API_KEY)


def get_client():
    global _client
    if _client is None:
        _client = genai.Client(
            api_key=settings.GEMINI_API_KEY,
            # Tiempo máximo de espera de la API externa: pasado este plazo se usa la alternativa local.
            http_options=types.HttpOptions(timeout=int(settings.AI_TIMEOUT_SECONDS * 1000)),
        )
    return _client


def _config(system, output_format, max_tokens):
    options = {
        'system_instruction': system,
        'response_mime_type': 'application/json',
        'response_json_schema': output_format.model_json_schema(),
        'max_output_tokens': max_tokens + THINKING_HEADROOM,
    }
    if settings.AI_THINKING_BUDGET is not None:
        options['thinking_config'] = types.ThinkingConfig(thinking_budget=settings.AI_THINKING_BUDGET)
    return types.GenerateContentConfig(**options)


def _failure_reason(error):
    """Causa legible de un fallo esperable del servicio; None si es un error de programación."""
    # Del más específico al más general: todos terminan en la alternativa local.
    if isinstance(error, AIUnavailable):
        return str(error)
    if isinstance(error, TIMEOUT_ERRORS):
        return 'Tiempo de espera agotado'
    if isinstance(error, genai_errors.ClientError):
        if error.code == 429:
            return 'Límite de uso del servicio'
        return 'Clave de API no válida' if error.code in (401, 403) else f'Solicitud rechazada ({error.code})'
    if isinstance(error, genai_errors.ServerError):
        return f'Error del servicio ({error.code})'
    if isinstance(error, NETWORK_ERRORS):
        return 'Sin conexión con el servicio de IA'
    if isinstance(error, (genai_errors.APIError, pydantic.ValidationError, ValueError)):
        return type(error).__name__
    return None


class _Call:
    """Una llamada al modelo: mide la latencia, anota los tokens y deja constancia en AIInteraction."""

    def __init__(self, feature):
        self.feature = feature
        self.record = AIInteraction(feature=feature, model=settings.AI_MODEL)

    def __enter__(self):
        self.started = time.monotonic()
        return self

    def note(self, response):
        """Anota modelo y tokens, y rechaza las respuestas bloqueadas o cortadas."""
        record = self.record
        record.model = getattr(response, 'model_version', None) or record.model
        usage = getattr(response, 'usage_metadata', None)
        if usage is not None:
            record.input_tokens = usage.prompt_token_count or record.input_tokens or 0
            record.output_tokens = usage.candidates_token_count or record.output_tokens or 0
            record.cache_read_tokens = usage.cached_content_token_count or record.cache_read_tokens or 0
        feedback = getattr(response, 'prompt_feedback', None)
        if feedback is not None and getattr(feedback, 'block_reason', None):
            raise AIUnavailable('El modelo bloqueó la solicitud')
        candidates = getattr(response, 'candidates', None) or []
        finish = getattr(getattr(candidates[0], 'finish_reason', None), 'name', None) if candidates else None
        if finish in BLOCKED:
            raise AIUnavailable('El modelo bloqueó la respuesta')
        if finish == 'MAX_TOKENS':
            raise AIUnavailable('Respuesta incompleta')

    def __exit__(self, exc_type, error, traceback):
        record = self.record
        if error is None:
            reason = ''
        elif isinstance(error, GeneratorExit):
            reason = 'Cancelada por el cliente'
        else:
            reason = _failure_reason(error)
        record.error = (type(error).__name__ if reason is None else reason)[:200]
        record.latency_ms = int((time.monotonic() - self.started) * 1000)
        record.fallback_used = bool(record.error)
        record.save()
        if record.error:
            logger.warning('IA (%s) no disponible: %s', self.feature, record.error)
        if error is None or reason is None or isinstance(error, (AIUnavailable, GeneratorExit)):
            return False
        raise AIUnavailable(record.error) from error


def _require_ai(feature):
    if not ai_enabled():
        AIInteraction.objects.create(feature=feature, fallback_used=True, error='IA desactivada')
        raise AIUnavailable('IA desactivada')


def structured_call(feature, *, system, user, output_format, effort='low', max_tokens=2000):
    """Devuelve (salida validada, modelo usado) o lanza AIUnavailable.

    `effort` se conserva por compatibilidad con los llamadores; en Gemini el razonamiento se
    controla con AI_THINKING_BUDGET.
    """
    _require_ai(feature)
    with _Call(feature) as call:
        response = get_client().models.generate_content(
            model=settings.AI_MODEL,
            contents=user,
            config=_config(system, output_format, max_tokens),
        )
        call.note(response)
        if not response.text:
            raise AIUnavailable('Respuesta incompleta')
        return output_format.model_validate_json(response.text), call.record.model


def partial_string_field(buffer, field):
    """Texto ya recibido de un campo de cadena dentro de un JSON todavía incompleto."""
    match = re.search(r'"%s"\s*:\s*"' % re.escape(field), buffer)
    if not match:
        return ''
    raw, escaped = [], False
    for char in buffer[match.end():]:
        if escaped:
            escaped = False
        elif char == '\\':
            escaped = True
        elif char == '"':
            break
        raw.append(char)
    text = ''.join(raw)
    # Un escape a medias (una barra suelta o un \uXXXX incompleto) se descarta hasta que llegue entero.
    for cut in range(len(text), max(len(text) - 6, -1), -1):
        try:
            return json.loads(f'"{text[:cut]}"')
        except ValueError:
            continue
    return ''


def structured_stream(feature, *, system, user, output_format, text_field, max_tokens=2000):
    """Como structured_call, pero generando: produce el texto de `text_field` a medida que llega.

    Cada elemento es el texto acumulado hasta ese momento; el valor de retorno del generador es
    (salida validada, modelo usado). Lanza AIUnavailable igual que structured_call.
    """
    _require_ai(feature)
    with _Call(feature) as call:
        buffer, shown = '', ''
        stream = get_client().models.generate_content_stream(
            model=settings.AI_MODEL,
            contents=user,
            config=_config(system, output_format, max_tokens),
        )
        for chunk in stream:
            call.note(chunk)
            buffer += chunk.text or ''
            partial = partial_string_field(buffer, text_field)
            if len(partial) > len(shown):
                shown = partial
                yield shown
        if not buffer:
            raise AIUnavailable('Respuesta incompleta')
        return output_format.model_validate_json(buffer), call.record.model

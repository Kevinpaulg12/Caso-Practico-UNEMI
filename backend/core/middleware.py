"""Observabilidad sin servicios externos: cuánto tarda cada petición y cuántas consultas hace."""
import logging
import time

from django.conf import settings
from django.db import connection

logger = logging.getLogger('dentalsense.performance')


class RequestTimingMiddleware:
    """Añade la cabecera Server-Timing y registra las peticiones lentas.

    La cabecera se ve en las herramientas del navegador (pestaña Red → Tiempos). Las peticiones que
    superan SLOW_REQUEST_MS quedan en el registro con su ruta, duración y número de consultas, que es
    lo primero que hace falta para encontrar un cuello de botella. Si más adelante se despliega un
    colector de OpenTelemetry, este es el punto donde se abriría el «span» de cada petición.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = time.perf_counter()
        queries_before = len(connection.queries) if settings.DEBUG else None
        response = self.get_response(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        timing = f'app;dur={elapsed_ms:.1f}'
        queries = None
        if queries_before is not None:
            queries = len(connection.queries) - queries_before
            timing += f', db;desc="{queries} consultas"'
        response['Server-Timing'] = timing
        if elapsed_ms >= settings.SLOW_REQUEST_MS:
            logger.warning(
                'Petición lenta: %s %s -> %s en %.0f ms%s',
                request.method, request.path, response.status_code, elapsed_ms,
                f' ({queries} consultas)' if queries is not None else '',
            )
        return response

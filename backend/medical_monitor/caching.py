"""Caché de los datos de catálogo, que se leen en casi todas las peticiones y casi nunca cambian.

Con CACHE_URL (Redis) la caché se comparte entre instancias; sin ella vive en la memoria del proceso.
Al guardar o borrar un protocolo, una guía de medicación o los umbrales de alerta, su entrada se
descarta, así que un cambio del administrador se ve de inmediato. DATA_CACHE_SECONDS=0 la desactiva.
"""
from django.conf import settings
from django.core.cache import cache
from django.db.models.signals import post_delete, post_save

PROTOCOL_CATALOG = 'catalogo:protocolos'
MEDICATION_GUIDES = 'catalogo:guias-medicacion'
VADEMECUM = 'catalogo:vademecum'
PATIENT_GUIDES = 'catalogo:guias-paciente'
ALERT_SETTINGS = 'catalogo:umbrales-alerta'


def cached(key, build):
    """Devuelve el valor en caché o lo construye; un fallo de la caché nunca rompe la petición."""
    seconds = settings.DATA_CACHE_SECONDS
    if not seconds:
        return build()
    try:
        value = cache.get(key)
    except Exception:  # Redis caído: se sigue leyendo de la base de datos.
        return build()
    if value is None:
        value = build()
        try:
            cache.set(key, value, seconds)
        except Exception:
            pass
    return value


def medication_guides():
    from .models import MedicationGuide
    return cached(MEDICATION_GUIDES, lambda: list(MedicationGuide.objects.all()))


def _forget(*keys):
    def handler(**kwargs):
        try:
            cache.delete_many(keys)
        except Exception:
            pass
    return handler


def connect_invalidation():
    from .models import AlertSettings, ClinicalProcedure, Medication, MedicationGuide
    for model, keys in ((ClinicalProcedure, (PROTOCOL_CATALOG,)), (MedicationGuide, (MEDICATION_GUIDES, PATIENT_GUIDES)),
                        (Medication, (VADEMECUM, PATIENT_GUIDES)), (AlertSettings, (ALERT_SETTINGS,))):
        handler = _forget(*keys)
        post_save.connect(handler, sender=model, weak=False, dispatch_uid=f'cache-save-{model.__name__}')
        post_delete.connect(handler, sender=model, weak=False, dispatch_uid=f'cache-delete-{model.__name__}')

from django.apps import AppConfig


class MedicalMonitorConfig(AppConfig):
    name = 'medical_monitor'

    def ready(self):
        from .caching import connect_invalidation
        connect_invalidation()

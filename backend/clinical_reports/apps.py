from django.apps import AppConfig


class ClinicalReportsConfig(AppConfig):
    """Característica opcional: informes clínicos del odontólogo (se instala con ENABLE_REPORTS)."""

    name = 'clinical_reports'
    verbose_name = 'Informes clínicos'

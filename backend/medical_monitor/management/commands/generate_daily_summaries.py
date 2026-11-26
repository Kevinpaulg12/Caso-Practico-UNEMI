"""Prepara, una vez al día, la síntesis de los tratamientos cuyos pacientes conversaron desde la última.

Lo ejecuta el servicio «scheduler». El odontólogo encuentra la síntesis lista en su panel sin tener que
leer las conversaciones.
"""
from django.core.management.base import BaseCommand
from django.db.models import Max
from django.utils import timezone

from medical_monitor.ai.summaries import generate_summary
from medical_monitor.models import TreatmentPlan


class Command(BaseCommand):
    help = 'Genera la síntesis diaria de los tratamientos con conversaciones nuevas.'

    def handle(self, *args, **options):
        today = timezone.localdate()
        plans = (
            TreatmentPlan.objects.filter(is_active=True)
            .annotate(last_message=Max('conversations__messages__created_at'), last_summary=Max('summaries__created_at'))
            .filter(last_message__isnull=False)
            .select_related('patient', 'clinical_procedure', 'current_phase')
        )
        generated = 0
        for plan in plans:
            already_today = plan.last_summary and timezone.localtime(plan.last_summary).date() == today
            if already_today or (plan.last_summary and plan.last_summary >= plan.last_message):
                continue
            generate_summary(plan)
            generated += 1
        self.stdout.write(f'Síntesis generadas: {generated}')

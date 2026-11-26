from django.core.management.base import BaseCommand

from medical_monitor.reminders import send_pending


class Command(BaseCommand):
    help = 'Envía por correo los recordatorios pendientes (citas, reportes y cuidados). Se ejecuta cada 15 minutos.'

    def handle(self, *args, **options):
        sent = send_pending()
        self.stdout.write(self.style.SUCCESS(f'Recordatorios enviados: {sent}'))

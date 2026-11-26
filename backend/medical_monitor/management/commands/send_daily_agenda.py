from django.core.management.base import BaseCommand

from medical_monitor.daily_agenda import send_daily_agendas


class Command(BaseCommand):
    help = 'Envía a cada odontólogo su agenda del día (una vez al día, desde las 06:30). Lo ejecuta el programador.'

    def handle(self, *args, **options):
        sent = send_daily_agendas()
        self.stdout.write(self.style.SUCCESS(f'Agendas enviadas: {sent}'))

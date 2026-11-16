import statistics
import time

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from medical_monitor.models import TreatmentPlan
from users.authentication import touch
from users.models import User, UserProfile

MESSAGES = [
    'Tengo un poco de dolor y la mejilla algo hinchada.',
    'Me sangra un poco al cepillarme y siento mal sabor.',
    'Ya no me duele tanto, sin sangrado.',
    'El dolor es muy fuerte desde ayer y tengo fiebre.',
    'Siento hormigueo en el labio y no puedo abrir bien la boca.',
]


class Rollback(Exception):
    pass


class Command(BaseCommand):
    help = 'Mide el tiempo de respuesta del endpoint de autorreportes (RNF02) sin dejar datos guardados.'

    def add_arguments(self, parser):
        parser.add_argument('--requests', type=int, default=50)
        parser.add_argument('--threshold', type=float, default=0.2, help='Máximo permitido en segundos.')

    def handle(self, *args, **options):
        count = options['requests']
        if count < 1:
            raise CommandError('Indica al menos una petición.')
        try:
            with transaction.atomic():
                durations = self.measure(count)
                raise Rollback
        except Rollback:
            pass

        worst = max(durations)
        p95 = sorted(durations)[max(0, round(0.95 * count) - 1)]
        rows = [
            ('Peticiones', f'{count}'),
            ('Mediana', f'{statistics.median(durations) * 1000:.1f} ms'),
            ('Percentil 95', f'{p95 * 1000:.1f} ms'),
            ('Máximo', f'{worst * 1000:.1f} ms'),
            ('Umbral (RNF02)', f'{options["threshold"] * 1000:.0f} ms'),
        ]
        for label, value in rows:
            self.stdout.write(f'{label:<16}{value}')
        if worst > options['threshold']:
            raise CommandError('NO CUMPLE: al menos un autorreporte superó el umbral.')
        self.stdout.write(self.style.SUCCESS('CUMPLE: todos los autorreportes respondieron dentro del umbral.'))

    def measure(self, count):
        patient = User.objects.create_user('latencia.paciente', role=User.Roles.PATIENT)
        UserProfile.objects.create(user=patient)
        TreatmentPlan.objects.create(
            patient=patient, title='Exodoncia', treatment_type=TreatmentPlan.TreatmentType.THERAPY,
            schedule_description='Según indicación', instructions='Reposo',
        )
        touch(patient, force=True)
        client = APIClient(HTTP_HOST='localhost')
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(patient)}')
        durations = []
        for index in range(count):
            payload = {
                'pain_level': index % 11,
                'comparison': ('lower', 'same', 'higher')[index % 3],
                'message': MESSAGES[index % len(MESSAGES)],
            }
            start = time.perf_counter()
            response = client.post('/api/patient-reports/', payload, format='json')
            durations.append(time.perf_counter() - start)
            if response.status_code != 201:
                raise CommandError(f'El servidor respondió {response.status_code}: {response.content[:200]!r}')
        return durations

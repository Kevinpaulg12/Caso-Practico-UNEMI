"""Rendimiento: el número de consultas de los listados no crece con la cantidad de datos (sin N+1)."""
from datetime import timedelta
from io import StringIO

from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User

from .ai.prompts import protocol_catalog
from .models import AlertSettings, ClinicalProcedure, ControlVisit, TreatmentPhase, TreatmentPlan

# Ningún listado necesita más consultas que estas, tenga los datos que tenga.
QUERY_BUDGET = 6
# El informe agrega varias tablas (reportes, tratamientos, recetas, altas, citas y controles): una consulta
# fija por tabla, sin importar cuántos datos haya.
ENDPOINT_BUDGETS = {'/api/reports/summary/': 8}

# Listados que más se consultan, por rol.
DOCTOR_ENDPOINTS = [
    '/api/patients/', '/api/treatment-plans/', '/api/patient-reports/', '/api/prescriptions/',
    '/api/procedures/', '/api/discharges/', '/api/reports/summary/',
]
PATIENT_ENDPOINTS = [
    '/api/treatment-plans/', '/api/patient-reports/', '/api/prescriptions/', '/api/reminders/',
    '/api/care-checkins/', '/api/assistant/messages/',
]
ADMIN_ENDPOINTS = ['/api/admin/users/', '/api/procedures/', '/api/audit-events/', '/api/medication-guides/', '/api/ai/metrics/']


class QueryCountTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_demo', force=True, stdout=StringIO())
        User.objects.create_user('admin.prueba', password='x', role=User.Roles.ADMIN)

    def count(self, url):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(url)
        self.assertLess(response.status_code, 400, f'{url}: {response.status_code}')
        return len(queries)

    def measure(self, username, endpoints):
        self.client.force_authenticate(User.objects.get(username=username))
        return {url: self.count(url) for url in endpoints}

    def test_list_endpoints_stay_within_a_query_budget(self):
        measured = {
            **self.measure('doctor.demo', DOCTOR_ENDPOINTS),
            **self.measure('paciente.ortodoncia', PATIENT_ENDPOINTS),
            **self.measure('admin.prueba', ADMIN_ENDPOINTS),
        }
        over = {url: queries for url, queries in measured.items() if queries > ENDPOINT_BUDGETS.get(url, QUERY_BUDGET)}
        self.assertEqual(over, {}, f'Listados con más de {QUERY_BUDGET} consultas (posible N+1)')

    def test_treatment_plans_do_not_add_queries_per_plan(self):
        doctor = User.objects.get(username='doctor.demo')
        self.client.force_authenticate(doctor)
        before = self.count('/api/treatment-plans/')
        patient = User.objects.get(username='paciente.ortodoncia')
        template = TreatmentPlan.objects.filter(patient=patient).first()
        for index in range(6):
            plan = TreatmentPlan.objects.create(
                patient=patient, title=f'Plan {index}', treatment_type='therapy', schedule_description='x',
                instructions='x', clinical_procedure=template.clinical_procedure,
            )
            TreatmentPhase.objects.create(treatment_plan=plan, name='Fase', order=1)
            ControlVisit.objects.create(treatment_plan=plan, doctor=doctor, date=timezone.localdate())
        self.assertLessEqual(self.count('/api/treatment-plans/'), before)

    def test_responses_are_compressed_timed_and_paginated(self):
        self.client.force_authenticate(User.objects.get(username='doctor.demo'))
        response = self.client.get('/api/procedures/?page_size=100', HTTP_ACCEPT_ENCODING='gzip')
        self.assertEqual(response['Content-Encoding'], 'gzip')
        self.assertIn('app;dur=', response['Server-Timing'])
        page = self.client.get('/api/procedures/?page_size=3').data
        self.assertEqual(len(page['results']), 3)
        self.assertGreater(page['count'], 3)
        # El tamaño de página tiene tope: nadie puede pedir la tabla entera de una vez.
        self.assertLessEqual(len(self.client.get('/api/patient-reports/?page_size=100000').data['results']), 100)


@override_settings(DATA_CACHE_SECONDS=600, CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class CatalogCacheTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def test_catalog_is_read_once_and_refreshed_when_it_changes(self):
        first = protocol_catalog()
        with self.assertNumQueries(0):
            self.assertEqual(protocol_catalog(), first)
        protocol = ClinicalProcedure.objects.filter(is_active=True).first()
        protocol.name = 'Protocolo renombrado por el administrador'
        protocol.save()
        self.assertIn('Protocolo renombrado por el administrador', protocol_catalog())

    def test_alert_thresholds_follow_the_admin_changes(self):
        settings = AlertSettings.load()
        with self.assertNumQueries(0):
            AlertSettings.load()
        settings.high_pain = 9
        settings.save()
        self.assertEqual(AlertSettings.load().high_pain, 9)

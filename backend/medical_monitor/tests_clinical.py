"""Pruebas de los módulos clínicos: reglas, auditoría, catálogo, informes, altas y administración."""
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from users.models import User, UserProfile

from .models import AlertSettings, AuditEvent, ClinicalProcedure, Prescription, TreatmentPlan
from .services import evaluate_patient_status


class ClinicalTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('doctor', password='x', role=User.Roles.DOCTOR, email='d@example.com')
        cls.other_doctor = User.objects.create_user('other', password='x', role=User.Roles.DOCTOR)
        cls.admin = User.objects.create_user('admin', password='x', role=User.Roles.ADMIN)
        cls.patient = User.objects.create_user('patient', password='x', role=User.Roles.PATIENT, first_name='Ana', last_name='Ruiz')
        UserProfile.objects.create(user=cls.patient, primary_doctor=cls.doctor)
        cls.plan = TreatmentPlan.objects.create(
            patient=cls.patient, title='x', treatment_type='therapy', schedule_description='x',
            instructions='x', procedure='Exodoncia',
        )

    def login(self, user):
        self.client.force_authenticate(user=user)

    def report(self, pain=3, message='Sin novedades', comparison='same'):
        self.login(self.patient)
        return self.client.post(
            '/api/patient-reports/',
            {'pain_level': pain, 'comparison': comparison, 'message': message},
            format='json',
        )


class AlertSettingsTests(ClinicalTestCase):
    url = '/api/alert-settings/'

    def test_only_admin(self):
        for user in (self.doctor, self.patient):
            with self.subTest(user=user.username):
                self.login(user)
                self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_thresholds_change_the_triage_and_are_audited(self):
        self.assertEqual(evaluate_patient_status(6, 'same', '')['risk_level'], 'Medio')
        self.login(self.admin)
        response = self.client.patch(self.url, {'high_pain': 6}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(evaluate_patient_status(6, 'same', '')['risk_level'], 'Alto')
        self.assertTrue(AuditEvent.objects.filter(module='Reglas', actor=self.admin).exists())

    def test_invalid_thresholds(self):
        self.login(self.admin)
        for data in ({'high_pain': 11}, {'medium_pain': 0}, {'high_pain': 3, 'medium_pain': 5}):
            with self.subTest(data=data):
                self.assertEqual(self.client.patch(self.url, data, format='json').status_code, 400)
        self.assertEqual(AlertSettings.load().high_pain, 7)


class AuditTests(ClinicalTestCase):
    def test_key_actions_are_recorded(self):
        self.report()
        self.assertTrue(AuditEvent.objects.filter(actor=self.patient, module='Portal Paciente').exists())
        self.client.force_authenticate(user=None)
        self.client.post('/api/token/', {'username': 'patient', 'password': 'mala'}, format='json')
        self.assertTrue(AuditEvent.objects.filter(action__contains='denegado', actor_label='patient').exists())

    def test_only_admin_reads_and_nobody_edits(self):
        self.report()
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/audit-events/').status_code, 403)
        self.login(self.admin)
        response = self.client.get('/api/audit-events/', {'search': 'autorreporte', 'days': '7'})
        self.assertEqual(response.data['count'], 1)
        url = f"/api/audit-events/{response.data['results'][0]['id']}/"
        self.assertEqual(self.client.delete(url).status_code, 405)
        self.assertEqual(self.client.get('/api/audit-events/', {'days': 'x'}).status_code, 400)
        with self.assertRaises(ValueError):
            AuditEvent.objects.first().save()


class ProcedureTests(ClinicalTestCase):
    def test_migration_loads_procedures_and_admin_edits(self):
        self.login(self.admin)
        # 6 procedimientos quirúrgicos originales + 13 protocolos del resto de especialidades.
        self.assertEqual(self.client.get('/api/procedures/').data['count'], 19)
        self.assertEqual(
            set(ClinicalProcedure.objects.values_list('specialty', flat=True)),
            set(ClinicalProcedure.Specialty.values),
        )
        procedure = ClinicalProcedure.objects.get(code='COD-MAX-014')
        response = self.client.patch(
            f'/api/procedures/{procedure.pk}/', {'monitoring_days': 6, 'expected_curve': [7, 5, 3]}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        procedure.refresh_from_db()
        self.assertEqual(procedure.monitoring_days, 6)

    def test_validation_and_permissions(self):
        procedure = ClinicalProcedure.objects.first()
        self.login(self.admin)
        for data in ({'monitoring_days': 0}, {'expected_curve': [11]}, {'expected_curve': 'x'}):
            with self.subTest(data=data):
                response = self.client.patch(f'/api/procedures/{procedure.pk}/', data, format='json')
                self.assertEqual(response.status_code, 400)
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/procedures/').status_code, 200)
        self.assertEqual(self.client.patch(f'/api/procedures/{procedure.pk}/', {}, format='json').status_code, 403)
        self.login(self.patient)
        self.assertEqual(self.client.get('/api/procedures/').status_code, 403)
        self.assertEqual(self.client.get('/api/medication-guides/').status_code, 403)


class ReportsSummaryTests(ClinicalTestCase):
    url = '/api/reports/summary/'

    def test_aggregates_only_own_patients(self):
        self.report(9, 'tengo hemorragia')
        self.report(2, 'mejor')
        self.login(self.doctor)
        data = self.client.get(self.url).data
        self.assertEqual(data['patients_monitored'], 1)
        self.assertEqual(data['alerts_high'], 1)
        self.assertEqual(data['risk_distribution']['Bajo'], 1)
        self.assertEqual(data['pain_by_day'], [{'day': 0, 'average': 5.5, 'reports': 2}])
        self.assertEqual(data['top_symptoms'], [{'label': 'Sangrado', 'count': 1}])
        self.login(self.other_doctor)
        self.assertEqual(self.client.get(self.url).data['patients_monitored'], 0)

    def test_permissions_and_validation(self):
        self.login(self.admin)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.login(self.doctor)
        self.assertEqual(self.client.get(self.url, {'days': 'x'}).status_code, 400)


class DischargeTests(ClinicalTestCase):
    def test_discharge_closes_treatment_and_appears_in_history(self):
        self.login(self.doctor)
        response = self.client.post(f'/api/patients/{self.patient.pk}/discharge/')
        self.assertEqual(response.status_code, 200)
        self.plan.refresh_from_db()
        self.assertFalse(self.plan.is_active)
        history = self.client.get('/api/discharges/', {'search': 'Ruiz'}).data
        self.assertEqual(history[0]['procedure'], 'Exodoncia')
        self.assertEqual(history[0]['followup_days'], 1)
        self.assertEqual(self.client.post(f'/api/patients/{self.patient.pk}/discharge/').status_code, 400)

    def test_foreign_doctor_and_other_roles_cannot_discharge(self):
        self.login(self.other_doctor)
        self.assertEqual(self.client.post(f'/api/patients/{self.patient.pk}/discharge/').status_code, 404)
        self.login(self.admin)
        self.assertEqual(self.client.post(f'/api/patients/{self.patient.pk}/discharge/').status_code, 403)
        self.assertEqual(self.client.get('/api/discharges/').status_code, 403)


class AdminUserTests(ClinicalTestCase):
    url = '/api/admin/users/'

    def test_only_admin(self):
        self.login(self.doctor)
        self.assertEqual(self.client.get(self.url).status_code, 403)

    def test_list_search_and_summary(self):
        self.login(self.admin)
        self.assertEqual(self.client.get(self.url).data['count'], 4)
        self.assertEqual(self.client.get(self.url, {'search': 'Ruiz'}).data['count'], 1)
        summary = self.client.get(f'{self.url}summary/').data
        self.assertEqual((summary['doctors'], summary['patients'], summary['admins']), (2, 1, 1))

    def test_create_staff_with_temporary_password(self):
        self.login(self.admin)
        response = self.client.post(
            self.url, {'username': 'nueva', 'first_name': 'Eva', 'last_name': 'Paz', 'role': 'DOC'}, format='json',
        )
        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username='nueva')
        self.assertTrue(user.must_change_password)
        self.assertTrue(user.check_password(response.data['temporary_password']))

    def test_rules_on_roles_and_self_deactivation(self):
        self.login(self.admin)
        response = self.client.post(self.url, {'username': 'p', 'role': 'PAT'}, format='json')
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(f'{self.url}{self.doctor.pk}/', {'role': 'ADM'}, format='json')
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(f'{self.url}{self.admin.pk}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(f'{self.url}{self.doctor.pk}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(user=None)
        login = self.client.post('/api/token/', {'username': 'doctor', 'password': 'x'}, format='json')
        self.assertEqual(login.status_code, 401)


class NotificationTests(ClinicalTestCase):
    def test_high_risk_emails_the_primary_doctor(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.report(9)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['d@example.com'])

    def test_low_risk_does_not_email(self):
        self.report(1)
        self.assertEqual(mail.outbox, [])


class SecurityTests(ClinicalTestCase):
    def test_login_is_throttled(self):
        cache.clear()
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {'login': '2/min'}):
            codes = [
                self.client.post('/api/token/', {'username': 'x', 'password': 'y'}, format='json').status_code
                for _ in range(3)
            ]
        self.assertEqual(codes, [401, 401, 429])

    def test_seed_refuses_without_debug(self):
        Prescription.objects.create(doctor=self.doctor, patient=self.patient, details='x')
        with self.assertRaises(CommandError):
            call_command('seed_demo', stdout=StringIO())
        self.assertEqual(Prescription.objects.count(), 1)

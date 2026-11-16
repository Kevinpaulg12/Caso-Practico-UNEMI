"""Consentimiento del paciente en su primer acceso y nombres en formato título."""
from django.test import TestCase
from rest_framework.test import APITestCase

from medical_monitor.models import AuditEvent

from .models import TERMS_VERSION, User, title_case_name

PATIENT_DATA = {
    'first_name': 'Ana', 'last_name': 'López', 'national_id': '1712345678',
    'birth_date': '1990-05-10', 'phone': '0991234567', 'emergency_contact': '0997654321',
}


class FirstAccessConsentTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('doctor', password='x', role=User.Roles.DOCTOR)
        cls.admin = User.objects.create_user('admin', password='x', role=User.Roles.ADMIN)

    def setUp(self):
        self.client.force_authenticate(user=self.doctor)
        response = self.client.post('/api/patients/', PATIENT_DATA, format='json')
        self.assertEqual(response.status_code, 201)
        self.patient = User.objects.get(pk=response.data['id'])
        self.temporary_password = response.data['temporary_password']
        self.client.force_authenticate(user=self.patient)

    def accept(self, accepted=True, version=TERMS_VERSION):
        return self.client.post('/api/account/terms/', {'accepted': accepted, 'version': version}, format='json')

    def change_password(self):
        return self.client.post('/api/account/password/', {
            'current_password': self.temporary_password,
            'new_password': 'Nueva-clave-segura-2026!',
            'confirm_password': 'Nueva-clave-segura-2026!',
        }, format='json')

    def test_registered_patient_must_accept_terms_before_anything_else(self):
        self.assertTrue(self.patient.must_accept_terms)
        self.assertTrue(self.patient.must_change_password)
        me = self.client.get('/api/me/')
        self.assertEqual(me.status_code, 200)
        self.assertTrue(me.data['must_accept_terms'])
        self.assertEqual(self.client.post('/api/session/ping/').status_code, 204)
        blocked = self.client.get('/api/prescriptions/')
        self.assertEqual(blocked.status_code, 403)
        self.assertIn('Términos', str(blocked.data['detail']))
        # El orden es estricto: primero el consentimiento, luego el cambio de contraseña.
        self.assertEqual(self.change_password().status_code, 403)
        self.assertEqual(self.client.get('/api/account/').status_code, 403)

    def test_declining_keeps_the_portal_blocked_and_is_audited(self):
        response = self.accept(accepted=False)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['must_accept_terms'])
        self.assertEqual(self.client.get('/api/prescriptions/').status_code, 403)
        self.assertTrue(AuditEvent.objects.filter(actor=self.patient, action__startswith='Rechazó').exists())

    def test_accepting_records_date_and_version_then_asks_for_the_new_password(self):
        response = self.accept()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['must_change_password'])
        self.patient.refresh_from_db()
        self.assertFalse(self.patient.must_accept_terms)
        self.assertIsNotNone(self.patient.terms_accepted_at)
        self.assertEqual(self.patient.terms_version, TERMS_VERSION)
        self.assertTrue(AuditEvent.objects.filter(actor=self.patient, action__startswith='Aceptó').exists())
        blocked = self.client.get('/api/prescriptions/')
        self.assertEqual(blocked.status_code, 403)
        self.assertIn('contraseña', str(blocked.data['detail']))
        self.assertEqual(self.change_password().status_code, 200)
        self.assertEqual(self.client.get('/api/prescriptions/').status_code, 200)

    def test_terms_status_and_invalid_answers(self):
        status = self.client.get('/api/account/terms/').data
        self.assertEqual((status['version'], status['must_accept_terms']), (TERMS_VERSION, True))
        self.assertEqual(self.accept(version='antigua').status_code, 400)
        self.assertEqual(self.client.post('/api/account/terms/', {'accepted': 'si'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/account/terms/', {}, format='json').status_code, 400)
        self.patient.refresh_from_db()
        self.assertTrue(self.patient.must_accept_terms)

    def test_staff_accounts_are_not_asked_for_patient_consent(self):
        self.client.force_authenticate(user=self.admin)
        doctor = self.client.post('/api/admin/users/', {
            'username': 'nueva.doctora', 'first_name': 'Eva', 'last_name': 'Paz', 'role': 'DOC',
        }, format='json')
        self.assertEqual(doctor.status_code, 201)
        self.assertFalse(User.objects.get(username='nueva.doctora').must_accept_terms)
        self.assertFalse(self.doctor.must_accept_terms)
        # Los pacientes solo se registran desde la consulta, que siempre pide su consentimiento.
        patient = self.client.post('/api/admin/users/', {
            'username': 'nuevo.paciente', 'first_name': 'Luis', 'last_name': 'Mora', 'role': 'PAT',
        }, format='json')
        self.assertEqual(patient.status_code, 400)


class TitleCaseNameTests(APITestCase):
    def test_helper(self):
        for raw, expected in (
            ('KEVIN', 'Kevin'),
            ('kevin davila', 'Kevin Davila'),
            ('  maría   JOSÉ ', 'María José'),
            ("o'brien-SMITH", "O'Brien-Smith"),
            ('ñUSTA', 'Ñusta'),
            ('', ''),
        ):
            with self.subTest(raw=raw):
                self.assertEqual(title_case_name(raw), expected)

    def test_every_save_normalizes_the_names(self):
        user = User.objects.create_user('nombres', first_name='KEVIN', last_name='davila')
        self.assertEqual((user.first_name, user.last_name), ('Kevin', 'Davila'))
        user.first_name = 'ana LUCÍA'
        user.save()
        user.refresh_from_db()
        self.assertEqual(user.get_full_name(), 'Ana Lucía Davila')

    def test_registration_and_account_update_return_title_case(self):
        doctor = User.objects.create_user('doctor', password='x', role=User.Roles.DOCTOR)
        self.client.force_authenticate(user=doctor)
        response = self.client.post(
            '/api/patients/', {**PATIENT_DATA, 'first_name': 'KEVIN ANDRÉS', 'last_name': 'davila'}, format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['full_name'], 'Kevin Andrés Davila')
        found = self.client.get('/api/patients/', {'search': PATIENT_DATA['national_id']}).data[0]
        self.assertEqual(found['full_name'], 'Kevin Andrés Davila')

        response = self.client.patch('/api/account/', {'first_name': 'laura', 'last_name': 'MENDOZA'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.data['first_name'], response.data['last_name']), ('Laura', 'Mendoza'))


class ExistingNamesMigrationTests(TestCase):
    def test_title_case_helper_matches_the_data_migration(self):
        from importlib import import_module
        migration = import_module('users.migrations.0007_terms_consent_and_title_case')
        for raw in ('KEVIN davila', "o'brien", '  ana  ', ''):
            self.assertEqual(migration.title_case(raw), title_case_name(raw))

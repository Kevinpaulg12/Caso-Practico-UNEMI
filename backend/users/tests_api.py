"""Pruebas de cuentas, perfiles y pacientes.

Los identificadores BUG-nn remiten a defectos ya corregidos: estas pruebas evitan que vuelvan.
"""
from datetime import date, timedelta
from unittest.mock import patch

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APITestCase

from medical_monitor.models import PatientReport, Prescription, TreatmentPlan

from .models import User, UserProfile

STRONG_PASSWORD = 'New-secure-pass-456!'
VALID_PATIENT = {
    'first_name': 'Ana',
    'last_name': 'López',
    'national_id': '1723456789',
    'birth_date': '1995-05-10',
    'phone': '0991234567',
    'emergency_contact': '0987654321',
}


class BaseTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('doctor', password='x', role=User.Roles.DOCTOR)
        cls.other_doctor = User.objects.create_user('other-doctor', password='x', role=User.Roles.DOCTOR)
        cls.admin = User.objects.create_user('admin', password='x', role=User.Roles.ADMIN)
        cls.patient = User.objects.create_user(
            'patient', password='Current-pass-123!', role=User.Roles.PATIENT,
            first_name='Carlos', last_name='Pérez',
        )

    def login(self, user):
        self.client.force_authenticate(user=user)


class UserModelTests(BaseTestCase):
    def age_for(self, birth_date):
        user = User.objects.create_user(f'user-{birth_date}', password='x')
        UserProfile.objects.create(user=user, birth_date=birth_date)
        return user.age

    @patch('users.models.timezone.localdate', return_value=date(2026, 6, 15))
    def test_age_around_the_birthday(self, _localdate):
        cases = [
            (date(2000, 6, 14), 26), (date(2000, 6, 15), 26), (date(2000, 6, 16), 25),
            (date(2026, 6, 15), 0), (date(2000, 2, 29), 26),
        ]
        for birth_date, expected in cases:
            with self.subTest(birth_date=birth_date):
                self.assertEqual(self.age_for(birth_date), expected)

    def test_age_is_none_without_profile_or_birth_date(self):
        self.assertIsNone(self.patient.age)
        UserProfile.objects.create(user=self.patient)
        self.assertIsNone(User.objects.get(pk=self.patient.pk).age)

    def test_new_user_defaults_to_patient(self):
        self.assertEqual(User.objects.create_user('nuevo', password='x').role, User.Roles.PATIENT)


class CurrentUserTests(BaseTestCase):
    def test_titles_by_role(self):
        for user, title in ((self.doctor, 'Doctor'), (self.admin, 'Administrador'), (self.patient, 'Paciente')):
            with self.subTest(user=user.username):
                self.login(user)
                self.assertEqual(self.client.get('/api/me/').data['professional_title'], title)

    def test_never_exposes_password(self):
        self.login(self.patient)
        self.assertNotIn('password', self.client.get('/api/me/').data)
        self.assertNotIn('password', self.client.get('/api/account/').data)

    def test_me_is_read_only(self):
        self.login(self.patient)
        self.assertEqual(self.client.post('/api/me/', {'role': 'ADM'}, format='json').status_code, 405)


class AccountTests(BaseTestCase):
    def test_get_creates_missing_profile(self):
        self.login(self.patient)
        self.assertEqual(self.client.get('/api/account/').status_code, 200)
        self.assertTrue(UserProfile.objects.filter(user=self.patient).exists())

    def test_protected_fields_cannot_be_changed(self):
        UserProfile.objects.create(user=self.patient, national_id='1111111111')
        self.login(self.patient)
        response = self.client.patch('/api/account/', {
            'role': 'ADM', 'username': 'hacker', 'national_id': '2222222222', 'id': 999,
        }, format='json')
        self.assertEqual(response.status_code, 200)
        user = User.objects.select_related('profile').get(pk=self.patient.pk)
        self.assertEqual(user.role, User.Roles.PATIENT)
        self.assertEqual(user.username, 'patient')
        self.assertEqual(user.profile.national_id, '1111111111')

    def test_invalid_email_and_date_are_rejected(self):
        self.login(self.patient)
        for data in ({'email': 'no-email'}, {'birth_date': 'ayer'}):
            with self.subTest(data=data):
                self.assertEqual(self.client.patch('/api/account/', data, format='json').status_code, 400)

    def test_birth_date_can_be_cleared_with_null(self):
        self.login(self.patient)
        response = self.client.patch('/api/account/', {'birth_date': None}, format='json')
        self.assertEqual(response.status_code, 200)

    def test_bug20_form_with_blank_birth_date_can_be_saved(self):
        # BUG-20: Account.jsx envía birth_date='': quien no tiene fecha no puede guardar su perfil.
        self.login(self.doctor)
        response = self.client.patch('/api/account/', {
            'first_name': 'Laura', 'last_name': 'Mendoza', 'email': '',
            'phone': '0990000000', 'emergency_contact': '', 'birth_date': '',
        }, format='json')
        self.assertEqual(response.status_code, 200)

    def test_bug21_future_birth_date_is_rejected(self):
        # BUG-21: el registro valida la fecha; la edición de cuenta no (la edad sale negativa).
        self.login(self.patient)
        future = (timezone.localdate() + timedelta(days=30)).isoformat()
        self.assertEqual(self.client.patch('/api/account/', {'birth_date': future}, format='json').status_code, 400)

    def test_bug22_phone_over_column_limit_is_rejected(self):
        # BUG-22: el campo no declara max_length; en PostgreSQL esto termina en DataError (500).
        self.login(self.patient)
        self.assertEqual(self.client.patch('/api/account/', {'phone': '1' * 31}, format='json').status_code, 400)

    def test_bug22_phone_format_is_validated(self):
        self.login(self.patient)
        self.assertEqual(self.client.patch('/api/account/', {'phone': 'no tengo'}, format='json').status_code, 400)

    def test_bug23_admin_title_matches_me_endpoint(self):
        # BUG-23: /account/ muestra "Paciente" a un administrador; /me/ dice "Administrador".
        self.login(self.admin)
        self.assertEqual(self.client.get('/api/account/').data['professional_title'], 'Administrador')


class PatientProfileTests(BaseTestCase):
    def test_lists_only_own_profile(self):
        UserProfile.objects.create(user=self.doctor, phone='1')
        self.login(self.patient)
        response = self.client.get('/api/patient-profile/')
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['username'], 'patient')

    def test_foreign_profile_is_not_accessible(self):
        foreign = UserProfile.objects.create(user=self.doctor)
        self.login(self.patient)
        url = f'/api/patient-profile/{foreign.pk}/'
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {'phone': '1'}, format='json').status_code, 404)

    def test_primary_doctor_is_not_writable(self):
        profile = UserProfile.objects.create(user=self.patient, primary_doctor=self.doctor)
        self.login(self.patient)
        self.client.patch(
            f'/api/patient-profile/{profile.pk}/', {'primary_doctor': self.other_doctor.pk}, format='json',
        )
        profile.refresh_from_db()
        self.assertEqual(profile.primary_doctor, self.doctor)

    def test_bug24_national_id_cannot_be_changed_by_the_patient(self):
        # BUG-24: /account/ protege la cédula, pero /patient-profile/ permite cambiarla.
        profile = UserProfile.objects.create(user=self.patient, national_id='1111111111')
        self.login(self.patient)
        self.client.patch(f'/api/patient-profile/{profile.pk}/', {'national_id': '2222222222'}, format='json')
        profile.refresh_from_db()
        self.assertEqual(profile.national_id, '1111111111')


class ChangePasswordTests(BaseTestCase):
    def change(self, **overrides):
        self.login(self.patient)
        payload = {
            'current_password': 'Current-pass-123!',
            'new_password': STRONG_PASSWORD,
            'confirm_password': STRONG_PASSWORD,
            **overrides,
        }
        return self.client.post('/api/account/password/', payload, format='json')

    def assert_rejected(self, field_or_none, **overrides):
        response = self.change(**overrides)
        self.assertEqual(response.status_code, 400)
        if field_or_none:
            self.assertIn(field_or_none, response.data)
        self.assertTrue(User.objects.get(pk=self.patient.pk).check_password('Current-pass-123!'))

    def test_wrong_current_password(self):
        self.assert_rejected('current_password', current_password='bad')

    def test_mismatch(self):
        self.assert_rejected('confirm_password', confirm_password='Other-secure-456!')

    def test_weak_passwords_are_rejected(self):
        for password in ('123', '12345678', 'password', 'patient'):
            with self.subTest(password=password):
                self.assert_rejected(None, new_password=password, confirm_password=password)

    def test_missing_fields(self):
        self.login(self.patient)
        self.assertEqual(self.client.post('/api/account/password/', {}, format='json').status_code, 400)

    def test_success_allows_new_login(self):
        self.client.logout()
        self.assertEqual(self.change().status_code, 200)
        self.client.force_authenticate(user=None)
        for password, expected in ((STRONG_PASSWORD, 200), ('Current-pass-123!', 401)):
            with self.subTest(password=password):
                response = self.client.post(
                    '/api/token/', {'username': 'patient', 'password': password}, format='json',
                )
                self.assertEqual(response.status_code, expected)

    def test_bug25_previous_tokens_stop_working_after_password_change(self):
        # BUG-25: sin blacklist ni comprobación de password_changed: el token robado sigue vigente 60 min.
        token = self.client.post(
            '/api/token/', {'username': 'patient', 'password': 'Current-pass-123!'}, format='json',
        ).data['access']
        self.change()
        self.client.force_authenticate(user=None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(self.client.get('/api/me/').status_code, 401)

    def test_bug26_temporary_password_is_enforced_by_the_api(self):
        # BUG-26: must_change_password solo se comprueba en React; la API no lo aplica.
        user = User.objects.create_user('temporal', password='x', must_change_password=True)
        self.login(user)
        self.assertEqual(self.client.get('/api/prescriptions/').status_code, 403)


class PatientRegistrationTests(BaseTestCase):
    def register(self, user=None, **overrides):
        self.login(user or self.doctor)
        return self.client.post('/api/patients/', {**VALID_PATIENT, **overrides}, format='json')

    def test_creates_patient_with_unique_temporary_password(self):
        first = self.register()
        second = self.register(national_id='1723456780')
        self.assertEqual(first.status_code, 201)
        self.assertNotEqual(first.data['temporary_password'], second.data['temporary_password'])
        patient = User.objects.get(username='paciente.1723456789')
        self.assertEqual(patient.profile.primary_doctor, self.doctor)
        self.assertEqual(patient.role, User.Roles.PATIENT)

    def test_only_doctors_can_register(self):
        for user in (self.patient, self.admin):
            with self.subTest(user=user.username):
                self.assertEqual(self.register(user=user).status_code, 403)

    def test_duplicate_national_id_is_rejected(self):
        self.register()
        response = self.register()
        self.assertEqual(response.status_code, 400)
        self.assertIn('national_id', response.data)

    def test_field_validation(self):
        old = (timezone.localdate() - timedelta(days=365 * 122)).isoformat()
        cases = {
            'first_name': ['', 'A', 'Ana3', 'x' * 81],
            'last_name': ['', 'L', 'x' * 81],
            'national_id': ['', '1234567', '12345678a', '1' * 21],
            'birth_date': ['', 'ayer', '2099-01-01', old],
            'phone': ['', '123', 'abcdefgh', '1' * 31],
            'emergency_contact': ['', '123'],
        }
        for field, values in cases.items():
            for value in values:
                with self.subTest(field=field, value=value[:20]):
                    response = self.register(**{field: value})
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.data)
        self.assertFalse(User.objects.filter(username__startswith='paciente.').exists())

    def test_values_are_normalized_and_international_names_accepted(self):
        response = self.register(first_name='  María   José ', last_name="Wiśniewska-O'Brien", phone='+593 99 123 4567')
        self.assertEqual(response.status_code, 201)
        patient = User.objects.get(pk=response.data['id'])
        self.assertEqual(patient.first_name, 'María José')
        self.assertEqual(patient.profile.phone, '+593 99 123 4567')

    def test_newborn_can_be_registered(self):
        today = timezone.localdate()
        self.assertEqual(self.register(birth_date=today.isoformat()).status_code, 201)

    def test_new_patient_can_login_with_temporary_password(self):
        response = self.register()
        self.client.force_authenticate(user=None)
        login = self.client.post('/api/token/', {
            'username': response.data['username'], 'password': response.data['temporary_password'],
        }, format='json')
        self.assertEqual(login.status_code, 200)

    def test_bug27_login_with_national_id_as_the_form_offers(self):
        # BUG-27: el formulario dice "Usuario o cédula", pero el usuario es paciente.<cédula>.
        response = self.register()
        self.client.force_authenticate(user=None)
        login = self.client.post('/api/token/', {
            'username': VALID_PATIENT['national_id'], 'password': response.data['temporary_password'],
        }, format='json')
        self.assertEqual(login.status_code, 200)

    def test_bug28_username_collision_is_a_validation_error(self):
        # BUG-28: un usuario paciente.<cédula> sin perfil produce IntegrityError (500), sin transacción.
        User.objects.create_user('paciente.1723456789', password='x')
        self.client.raise_request_exception = False
        self.assertEqual(self.register().status_code, 400)


class PatientSearchTests(BaseTestCase):
    def make_patient(self, national_id, doctor=None, active=True, **fields):
        user = User.objects.create_user(f'paciente.{national_id}', password='x', **fields)
        UserProfile.objects.create(user=user, national_id=national_id, primary_doctor=doctor)
        if active:
            TreatmentPlan.objects.create(
                patient=user, title='Plan', treatment_type='therapy', schedule_description='x', instructions='x',
            )
        return user

    def search(self, **params):
        self.login(self.doctor)
        return self.client.get('/api/patients/', params)

    def test_only_doctors_can_search(self):
        for user in (self.patient, self.admin):
            with self.subTest(user=user.username):
                self.login(user)
                self.assertEqual(self.client.get('/api/patients/').status_code, 403)

    def test_without_search_lists_only_own_patients(self):
        assigned = self.make_patient('10000001', doctor=self.doctor)
        prescribed = self.make_patient('10000002')
        Prescription.objects.create(doctor=self.doctor, patient=prescribed, details='x')
        self.make_patient('10000003', doctor=self.other_doctor)
        self.assertEqual({item['id'] for item in self.search().data}, {assigned.id, prescribed.id})

    def test_search_by_each_field(self):
        patient = self.make_patient('10000004', doctor=self.doctor, first_name='Zoila', last_name='Quispe')
        self.make_patient('10000009', doctor=self.doctor, first_name='Zoila', last_name='Mora')
        for term in ('zoila quispe', 'QUISPE', '10000004', 'paciente.10000004', 'quispe zoi'):
            with self.subTest(term=term):
                self.assertEqual([item['id'] for item in self.search(search=term).data], [patient.id])

    def test_search_without_match_and_doctors_are_excluded(self):
        UserProfile.objects.create(user=self.other_doctor, national_id='20000000')
        self.assertEqual(self.search(search='noexiste').data, [])
        self.assertEqual(self.search(search='20000000').data, [])

    def test_results_are_capped(self):
        for number in range(30):
            self.make_patient(f'3000{number:04d}', doctor=self.doctor)
        self.assertEqual(len(self.search().data), 30)
        self.assertEqual(len(self.search(search='3000').data), 25)

    def test_high_risk_patients_come_first(self):
        calm = self.make_patient('10000011', doctor=self.doctor, first_name='Ana')
        urgent = self.make_patient('10000012', doctor=self.doctor, first_name='Zoe')
        PatientReport.objects.create(patient=calm, pain_level=1, comparison='same', risk_level='Bajo')
        PatientReport.objects.create(patient=urgent, pain_level=9, comparison='same', risk_level='Alto')
        self.assertEqual([item['id'] for item in self.search().data], [urgent.id, calm.id])

    def test_query_count_does_not_grow_with_patients(self):
        self.make_patient('10000013', doctor=self.doctor)
        self.login(self.doctor)
        with CaptureQueriesContext(connection) as few:
            self.client.get('/api/patients/')
        for number in range(10):
            self.make_patient(f'4000{number:04d}', doctor=self.doctor)
        with CaptureQueriesContext(connection) as many:
            self.client.get('/api/patients/')
        self.assertEqual(len(few), len(many))

    def test_risk_and_active_treatment_summary(self):
        patient = self.make_patient('10000005', doctor=self.doctor, active=False)
        item = self.search(search='10000005').data[0]
        self.assertEqual(item['risk_level'], 'Sin seguimiento')
        self.assertFalse(item['has_active_treatment'])
        self.assertIsNone(item['latest_report'])

        TreatmentPlan.objects.create(
            patient=patient, title='x', treatment_type='therapy',
            schedule_description='x', instructions='x',
        )
        PatientReport.objects.create(patient=patient, pain_level=9, comparison='same', risk_level='Alto')
        item = self.search().data[0]
        self.assertEqual(item['risk_level'], 'Alto')
        self.assertTrue(item['has_active_treatment'])
        self.assertEqual(item['latest_report']['pain_level'], 9)

    def test_dashboard_lists_only_patients_in_active_treatment(self):
        active = self.make_patient('10000021', doctor=self.doctor)
        discharged = self.make_patient('10000022', doctor=self.doctor)
        TreatmentPlan.objects.filter(patient=discharged).update(is_active=False)
        never_treated = self.make_patient('10000023', doctor=self.doctor, active=False)
        self.assertEqual([item['id'] for item in self.search().data], [active.id])
        # La consulta médica sí encuentra a los dados de alta para volver a atenderlos...
        self.assertEqual(
            {item['id'] for item in self.search(search='1000002').data}, {active.id, discharged.id, never_treated.id},
        )
        # ...y la búsqueda del panel puede limitarse a los que siguen en tratamiento.
        self.assertEqual([item['id'] for item in self.search(search='1000002', active='true').data], [active.id])

    def test_summary_uses_the_latest_report(self):
        patient = self.make_patient('10000006', doctor=self.doctor)
        PatientReport.objects.create(patient=patient, pain_level=9, comparison='same', risk_level='Alto')
        PatientReport.objects.create(patient=patient, pain_level=2, comparison='lower', risk_level='Bajo')
        self.assertEqual(self.search().data[0]['risk_level'], 'Bajo')

    def test_bug29_foreign_patient_needs_the_exact_national_id(self):
        patient = self.make_patient('10000007', doctor=self.other_doctor, first_name='Zoila')
        PatientReport.objects.create(patient=patient, pain_level=9, comparison='same', risk_level='Alto')
        self.assertEqual(self.search(search='1000').data, [])
        self.assertEqual(self.search(search='Zoila').data, [])
        item = self.search(search='10000007').data[0]
        self.assertEqual(item['id'], patient.id)
        self.assertEqual(item['risk_level'], 'Sin seguimiento')
        self.assertIsNone(item['latest_report'])

    def test_bug30_patient_without_profile_is_found(self):
        self.patient.first_name = 'Unico'
        self.patient.save()
        Prescription.objects.create(doctor=self.doctor, patient=self.patient, details='x')
        self.assertEqual(len(self.search(search='Unico').data), 1)

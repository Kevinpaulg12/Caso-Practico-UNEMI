from django.test import TestCase
from rest_framework.test import APITestCase
from django.utils import timezone

from .models import User, UserProfile


class UserProfileTests(TestCase):
    def test_age_is_calculated_from_birth_date(self):
        today = timezone.localdate()
        user = User.objects.create_user(username='profile-age', password='test-password')
        UserProfile.objects.create(
            user=user,
            birth_date=today.replace(year=today.year - 30),
        )

        self.assertEqual(user.age, 30)


class PatientRegistrationTests(APITestCase):
    def test_authenticated_user_can_read_and_update_account(self):
        user = User.objects.create_user(
            username='account-user',
            password='Current-pass-123!',
            first_name='Nombre',
            role=User.Roles.DOCTOR,
        )
        self.client.force_authenticate(user=user)

        response = self.client.get('/api/account/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['username'], 'account-user')

        response = self.client.patch(
            '/api/account/',
            {'first_name': 'Nuevo', 'phone': '0990000000'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertEqual(user.first_name, 'Nuevo')
        self.assertEqual(user.profile.phone, '0990000000')

    def test_user_can_change_password_with_current_password(self):
        user = User.objects.create_user(
            username='account-password',
            password='Current-pass-123!',
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            '/api/account/password/',
            {
                'current_password': 'Current-pass-123!',
                'new_password': 'New-secure-pass-456!',
                'confirm_password': 'New-secure-pass-456!',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password('New-secure-pass-456!'))

    def test_doctor_can_search_existing_patients(self):
        doctor = User.objects.create_user(
            username='doctor-search',
            password='test-password',
            role=User.Roles.DOCTOR,
        )
        patient = User.objects.create_user(
            username='paciente.searchable',
            password='test-password',
            first_name='María',
            last_name='Gómez',
            role=User.Roles.PATIENT,
        )
        UserProfile.objects.create(user=patient, national_id='1723456791', birth_date='1990-01-01')
        self.client.force_authenticate(user=doctor)

        response = self.client.get('/api/patients/?search=1723456791')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]['full_name'], 'María Gómez')

    def test_doctor_can_register_patient_with_birth_date(self):
        doctor = User.objects.create_user(
            username='doctor-register',
            password='test-password',
            role=User.Roles.DOCTOR,
        )
        self.client.force_authenticate(user=doctor)

        response = self.client.post(
            '/api/patients/',
            {
                'first_name': 'Ana',
                'last_name': 'López',
                'national_id': '1723456789',
                'birth_date': '1995-05-10',
                'phone': '0991234567',
                'emergency_contact': '0987654321',
                'email': 'ana.lopez@example.com',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        patient = User.objects.get(username='paciente.1723456789')
        self.assertEqual(patient.role, User.Roles.PATIENT)
        self.assertTrue(patient.must_change_password)
        self.assertEqual(patient.profile.birth_date.isoformat(), '1995-05-10')
        # La contraseña temporal nunca viaja en la respuesta: solo por correo.
        self.assertNotIn('temporary_password', response.data)
        self.assertEqual(response.data['credentials']['email'], 'a***@example.com')

    def test_patient_can_change_temporary_password_and_clear_first_login_flag(self):
        patient = User.objects.create_user(
            username='patient-first-login',
            password='Temporary-Secure-123!',
            role=User.Roles.PATIENT,
            must_change_password=True,
        )
        self.client.force_authenticate(user=patient)

        response = self.client.post(
            '/api/account/password/',
            {
                'current_password': 'Temporary-Secure-123!',
                'new_password': 'New-secure-pass-456!',
                'confirm_password': 'New-secure-pass-456!',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        patient.refresh_from_db()
        self.assertFalse(patient.must_change_password)
        self.assertTrue(patient.check_password('New-secure-pass-456!'))

    def test_patient_cannot_register_another_patient(self):
        patient = User.objects.create_user(
            username='patient-register',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=patient)

        response = self.client.post('/api/patients/', {}, format='json')

        self.assertEqual(response.status_code, 403)

    def test_birth_date_cannot_be_in_the_future(self):
        doctor = User.objects.create_user(
            username='doctor-future-date',
            password='test-password',
            role=User.Roles.DOCTOR,
        )
        self.client.force_authenticate(user=doctor)

        response = self.client.post(
            '/api/patients/',
            {
                'first_name': 'Ana',
                'last_name': 'López',
                'national_id': '1723456790',
                'birth_date': '2099-05-10',
                'phone': '0991234567',
                'emergency_contact': '0987654321',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)

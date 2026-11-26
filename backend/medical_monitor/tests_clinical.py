"""Pruebas de los módulos clínicos: reglas, auditoría, catálogo, informes, altas y administración."""
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework.throttling import ScopedRateThrottle

from users.models import User, UserProfile

from .models import AlertSettings, AuditEvent, ClinicalProcedure, InstructionPreset, Prescription, TreatmentPlan
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
        response = self.client.get('/api/audit-events/', {'search': 'cómo se siente', 'days': '7'})
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

    def test_activity_lists_the_treatments_the_doctor_started(self):
        self.login(self.doctor)
        for procedure, medications in (('Exodoncia simple', ['Amoxicilina', 'Ibuprofeno']), ('Exodoncia simple', []), ('Endodoncia', [])):
            response = self.client.post('/api/consultations/', {
                'patient': self.patient.pk, 'procedure': procedure, 'admission_reason': 'Dolor en molar inferior',
                'instructions': 'Compresas frías 15 minutos cada hora.', 'surgery_date': str(timezone.localdate()),
                'prescribes_medication': bool(medications),
                **({'medications': [{'medication_name': name, 'active_ingredient': name, 'strength': '500 mg',
                                     'dosage_form': 'Tableta', 'frequency': 'Cada 8 horas', 'duration': '3 días'}
                                    for name in medications]} if medications else {}),
            }, format='json')
            self.assertEqual(response.status_code, 201, response.data)
        # Un tratamiento de otro odontólogo no entra en su informe.
        TreatmentPlan.objects.create(patient=self.patient, doctor=self.other_doctor, title='x', treatment_type='therapy',
                                     schedule_description='x', instructions='x', procedure='Blanqueamiento')
        activity = self.client.get(self.url).data['activity']
        self.assertEqual((activity['treatments_started'], activity['treatments_active'], activity['patients_treated']), (3, 3, 1))
        self.assertEqual(activity['prescriptions_issued'], 2)
        self.assertEqual(activity['by_procedure'][0], {
            'procedure': 'Exodoncia simple', 'specialty': 'Sin protocolo', 'total': 2, 'active': 2, 'discharged': 0, 'patients': 1,
        })
        self.assertEqual({item['name'] for item in activity['top_medications']}, {'Amoxicilina', 'Ibuprofeno'})
        row = next(item for item in activity['treatments'] if item['medications'])
        self.assertEqual((row['patient_name'], row['status'], row['medications']), ('Ana Ruiz', 'En curso', ['Amoxicilina', 'Ibuprofeno']))
        self.login(self.other_doctor)
        self.assertEqual(self.client.get(self.url).data['activity']['treatments_started'], 1)

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
        # Sin correo no: por él recibe las alertas rojas y su agenda del día.
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.data)
        response = self.client.post(
            self.url, {'username': 'nueva', 'first_name': 'Eva', 'last_name': 'Paz', 'role': 'DOC', 'email': 'eva@clinica.ec'},
            format='json',
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
        self.assertIn('alerta roja', mail.outbox[0].subject)
        # Incluye lo que contó el paciente y el enlace directo a su tratamiento.
        self.assertIn('/panel-doctor/tratamientos/', mail.outbox[0].body)

    def test_without_the_dentist_email_the_other_dentists_are_warned(self):
        from .models import AuditEvent
        User.objects.filter(pk=self.doctor.pk).update(email='')
        self.patient.profile.primary_doctor.refresh_from_db()
        User.objects.create_user('guardia', password='x', role=User.Roles.DOCTOR, email='guardia@clinica.ec')
        with self.captureOnCommitCallbacks(execute=True):
            self.report(9)
        self.assertIn('guardia@clinica.ec', mail.outbox[0].to)
        self.assertIn('no tiene un correo registrado', mail.outbox[0].body)
        self.assertTrue(AuditEvent.objects.filter(action__startswith='Alerta sin correo del tratante').exists())

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


class InstructionPresetTests(ClinicalTestCase):
    URL = '/api/doctor/instruction-presets/'

    def test_doctor_saves_and_lists_only_own_phrases(self):
        InstructionPreset.objects.create(doctor=self.other_doctor, field='instructions', text='Frase de otro odontólogo')
        self.login(self.doctor)
        created = self.client.post(self.URL, {'field': 'instructions', 'text': '  Usa  cera de ortodoncia '}, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['text'], 'Usa cera de ortodoncia')
        self.client.post(self.URL, {'field': 'diet', 'text': 'Nada de chicle'}, format='json')
        listed = self.client.get(self.URL, {'field': 'instructions'})
        self.assertEqual([item['text'] for item in listed.data], ['Usa cera de ortodoncia'])
        self.assertEqual(len(self.client.get(self.URL).data), 2)

    def test_duplicate_and_limit_are_rejected(self):
        self.login(self.doctor)
        self.client.post(self.URL, {'field': 'diet', 'text': 'Dieta blanda'}, format='json')
        duplicate = self.client.post(self.URL, {'field': 'diet', 'text': 'dieta blanda'}, format='json')
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn('Ya tienes', str(duplicate.data['text']))
        InstructionPreset.objects.bulk_create([
            InstructionPreset(doctor=self.doctor, field='diet', text=f'Frase {index}') for index in range(29)
        ])
        full = self.client.post(self.URL, {'field': 'diet', 'text': 'Una más'}, format='json')
        self.assertEqual(full.status_code, 400)

    def test_doctor_deletes_only_own_phrase(self):
        other = InstructionPreset.objects.create(doctor=self.other_doctor, field='diet', text='Ajena')
        mine = InstructionPreset.objects.create(doctor=self.doctor, field='diet', text='Mía')
        self.login(self.doctor)
        self.assertEqual(self.client.delete(f'{self.URL}{other.id}/').status_code, 404)
        self.assertEqual(self.client.delete(f'{self.URL}{mine.id}/').status_code, 204)

    def test_patient_and_admin_cannot_use_presets(self):
        for user in (self.patient, self.admin):
            self.login(user)
            self.assertEqual(self.client.get(self.URL).status_code, 403)

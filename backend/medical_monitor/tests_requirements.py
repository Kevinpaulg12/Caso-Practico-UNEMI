"""Pruebas de aceptación de los requisitos del documento de tesis.

Cada clase corresponde a un requisito (RF/RNF) y cada prueba nombra el criterio de
aceptación (CA) o la historia de usuario (HU) que verifica.
"""
from datetime import timedelta
from io import StringIO

from django.conf import settings
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from users.authentication import touch
from users.models import User, UserProfile

from .tests_support import sample_clinical_data
from .models import ClinicalProcedure, PatientReport, Prescription, TreatmentPlan
from .nlp import extract_entities
from .services import evaluate_patient_status


class RequirementsTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('doctor', password='Clave-Segura-1', role=User.Roles.DOCTOR)
        cls.patient = User.objects.create_user('paciente', password='Clave-Segura-2', role=User.Roles.PATIENT)
        UserProfile.objects.create(user=cls.patient, primary_doctor=cls.doctor, national_id='1712345678')

    def bearer(self, user):
        touch(user, force=True)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(user)}')

    def make_plan(self, days_ago=0, **extra):
        return TreatmentPlan.objects.create(
            patient=self.patient, title='Exodoncia', treatment_type='therapy',
            schedule_description='Según indicación', instructions='Compresas frías 15 minutos.',
            start_date=timezone.localdate() - timedelta(days=days_ago), **extra,
        )

    def send_report(self, **data):
        self.client.force_authenticate(user=self.patient)
        payload = {'pain_level': 2, 'comparison': 'same', 'message': '', **data}
        return self.client.post('/api/patient-reports/', payload, format='json')


class RF01AuthenticationTests(RequirementsTestCase):
    def test_ca01_valid_credentials_grant_access_by_role(self):
        for user, password in ((self.doctor, 'Clave-Segura-1'), (self.patient, 'Clave-Segura-2')):
            with self.subTest(role=user.role):
                response = self.client.post('/api/token/', {'username': user.username, 'password': password}, format='json')
                self.assertEqual(response.status_code, 200)
                self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
                me = self.client.get('/api/me/').data
                self.assertEqual(me['role'], user.role)

    def test_ca01_each_role_only_reaches_its_functions(self):
        self.bearer(self.patient)
        self.assertEqual(self.client.get('/api/patients/').status_code, 403)
        self.bearer(self.doctor)
        self.assertEqual(self.client.post('/api/patient-reports/', {}, format='json').status_code, 403)

    def test_ca02_invalid_credentials_are_denied_with_a_message(self):
        response = self.client.post('/api/token/', {'username': 'doctor', 'password': 'mala'}, format='json')
        self.assertEqual(response.status_code, 401)
        self.assertIn('Credenciales inválidas', str(response.data['detail']))


class RNF01IdleTimeoutTests(RequirementsTestCase):
    def go_idle(self, user, minutes):
        User.objects.filter(pk=user.pk).update(last_activity=timezone.now() - timedelta(minutes=minutes))

    def test_threshold_is_five_minutes_and_matches_token_lifetime(self):
        self.assertEqual(settings.SESSION_IDLE_TIMEOUT_MINUTES, 5)
        self.assertEqual(settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'], timedelta(minutes=5))

    def test_session_expires_after_five_minutes_without_api_requests(self):
        self.bearer(self.patient)
        self.go_idle(self.patient, 5.5)
        response = self.client.get('/api/me/')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data['code'], 'session_idle')

    def test_activity_within_the_limit_keeps_the_session(self):
        self.bearer(self.patient)
        self.go_idle(self.patient, 4)
        self.assertEqual(self.client.get('/api/me/').status_code, 200)
        self.patient.refresh_from_db()
        self.assertLess(timezone.now() - self.patient.last_activity, timedelta(seconds=5))

    def test_background_refresh_of_a_screen_does_not_count_as_activity(self):
        self.bearer(self.doctor)
        self.go_idle(self.doctor, 4)
        self.client.get('/api/patients/', HTTP_X_BACKGROUND_REQUEST='1')
        self.doctor.refresh_from_db()
        self.assertGreater(timezone.now() - self.doctor.last_activity, timedelta(minutes=3))

    def test_refresh_token_cannot_revive_an_idle_session(self):
        refresh = str(RefreshToken.for_user(self.patient))
        touch(self.patient, force=True)
        self.assertEqual(self.client.post('/api/token/refresh/', {'refresh': refresh}, format='json').status_code, 200)
        self.go_idle(self.patient, 6)
        response = self.client.post('/api/token/refresh/', {'refresh': refresh}, format='json')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data['code'], 'session_idle')

    def test_expired_access_token_is_rejected(self):
        token = AccessToken.for_user(self.patient)
        token.set_exp(lifetime=-timedelta(seconds=1))
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(self.client.get('/api/me/').status_code, 401)

    def test_ping_keeps_an_active_user_signed_in(self):
        self.bearer(self.patient)
        self.go_idle(self.patient, 4)
        self.assertEqual(self.client.post('/api/session/ping/').status_code, 204)
        self.go_idle(self.patient, 0)
        self.assertEqual(self.client.get('/api/me/').status_code, 200)


class RF02SymptomExtractionTests(TestCase):
    def categories(self, text):
        return {
            (item['category'], item['intensity'], item['negated'])
            for item in extract_entities(text) if item['label'] == 'SINTOMA'
        }

    def test_ca01_extracts_symptoms_with_intensity(self):
        cases = {
            'Tengo mucho dolor y un poco de sangrado': {('Dolor', 'alta', False), ('Sangrado', 'leve', False)},
            'La mejilla está muy hinchada': {('Inflamación', 'alta', False)},
            'El sangrado no para': {('Sangrado', 'alta', False)},
            'Siento hormigueo en el labio': {('Adormecimiento', None, False)},
            'No puedo abrir la boca': {('Apertura bucal limitada', None, False)},
            'Inflamación moderada': {('Inflamación', 'moderada', False)},
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(self.categories(text), expected)

    def test_ca01_detects_negated_symptoms(self):
        self.assertEqual(
            self.categories('Ya no me duele, sin sangrado ni fiebre'),
            {('Dolor', None, True), ('Sangrado', None, True), ('Fiebre', None, True)},
        )

    def test_ca01_extracts_medication_dose_and_frequency(self):
        labels = [item['label'] for item in extract_entities('Ibuprofeno 400 mg cada 8 horas')]
        self.assertEqual(labels, ['MEDICAMENTO', 'DOSIS', 'FRECUENCIA'])

    def test_ca01_places_and_names_are_not_clinical_entities(self):
        self.assertEqual(extract_entities('María viajó a Quito'), [])


class RF02AlertLevelTests(RequirementsTestCase):
    def color(self, message, day, pain=2, comparison='same'):
        return evaluate_patient_status(pain, comparison, message, postoperative_day=day)['alert_color']

    def test_ca02_same_symptom_changes_level_with_postoperative_time(self):
        cases = [
            ('Tengo un poco de sangrado', 0, 'verde'),
            ('Tengo un poco de sangrado', 3, 'amarillo'),
            ('La mejilla está hinchada', 2, 'verde'),
            ('La mejilla está hinchada', 5, 'amarillo'),
            ('Adormecimiento en el labio', 1, 'verde'),
            ('Adormecimiento en el labio', 3, 'amarillo'),
        ]
        for message, day, expected in cases:
            with self.subTest(message=message, day=day):
                self.assertEqual(self.color(message, day), expected)

    def test_ca02_red_alerts(self):
        cases = [
            ('El sangrado no para', 0, 2, 'same'),
            ('La mejilla está más hinchada', 5, 3, 'higher'),
            ('Me duele más que ayer', 4, 5, 'higher'),
            ('Tengo fiebre y mal sabor', 2, 2, 'same'),
            ('No puedo abrir la boca', 1, 2, 'same'),
        ]
        for message, day, pain, comparison in cases:
            with self.subTest(message=message):
                self.assertEqual(self.color(message, day, pain, comparison), 'rojo')

    def test_ca02_negated_symptoms_do_not_raise_the_level(self):
        self.assertEqual(self.color('Ya no tengo sangrado ni fiebre', 4), 'verde')

    def test_ca02_level_and_reasons_are_stored(self):
        self.make_plan(days_ago=3)
        response = self.send_report(message='Me sigue sangrando un poco')
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('alert_color', response.data)
        report = PatientReport.objects.get()
        self.assertEqual((report.risk_level, report.postoperative_day), ('Medio', 3))
        self.assertEqual(report.alert_reasons, ['Sangrado después de las primeras 48 horas'])
        self.assertTrue(any(item.get('category') == 'Sangrado' for item in report.extracted_entities))

    def test_existing_duplicate_daily_summaries_do_not_break_reporting(self):
        from .models import ClinicalEvolutionSummary
        self.make_plan()
        for label in ('Día 1', 'Día 2'):
            ClinicalEvolutionSummary.objects.create(patient=self.patient, day_label=label, eva_recorded=3)
        self.assertEqual(self.send_report(pain_level=4).status_code, 201)
        self.assertEqual(ClinicalEvolutionSummary.objects.order_by('-id').first().eva_recorded, 4)

    def test_a_second_surgery_restarts_the_day_count_without_conflicts(self):
        from .models import ClinicalEvolutionSummary
        first = self.make_plan(days_ago=10)
        self.send_report()
        ClinicalEvolutionSummary.objects.update(created_at=timezone.now() - timedelta(days=10), day_label='Día 0')
        first.is_active = False
        first.save()
        self.make_plan(days_ago=0)
        response = self.send_report()
        self.assertEqual((response.status_code, response.data['postoperative_day']), (201, 0))
        self.assertEqual(list(ClinicalEvolutionSummary.objects.values_list('day_label', flat=True)), ['Día 0', 'Día 0'])

    def test_precondition_requires_an_active_treatment(self):
        response = self.send_report()
        self.assertEqual(response.status_code, 400)
        self.assertIn('tratamiento activo', str(response.data['detail']))
        self.make_plan(is_active=False)
        self.assertEqual(self.send_report().status_code, 400)


class RNF02LatencyTests(RequirementsTestCase):
    def test_reports_answer_within_200_ms_and_leave_no_data(self):
        output = StringIO()
        call_command('measure_report_latency', requests=20, stdout=output)
        self.assertIn('CUMPLE', output.getvalue())
        self.assertFalse(User.objects.filter(username='latencia.paciente').exists())
        self.assertEqual(PatientReport.objects.count(), 0)


class RF03DashboardTests(RequirementsTestCase):
    def test_ca01_red_alerts_are_listed_first(self):
        calm = User.objects.create_user('a-tranquilo', role=User.Roles.PATIENT, first_name='Ana')
        UserProfile.objects.create(user=calm, primary_doctor=self.doctor)
        # El panel lista a los pacientes en tratamiento activo.
        self.make_plan()
        TreatmentPlan.objects.create(
            patient=calm, title='Exodoncia', treatment_type='therapy',
            schedule_description='Según indicación', instructions='Compresas frías 15 minutos.',
        )
        PatientReport.objects.create(patient=calm, pain_level=1, comparison='same', risk_level='Bajo')
        PatientReport.objects.create(patient=self.patient, pain_level=9, comparison='same', risk_level='Alto')
        self.bearer(self.doctor)
        ids = [item['id'] for item in self.client.get('/api/patients/').data]
        self.assertEqual(ids[0], self.patient.id)

    def test_ca02_history_for_the_chart_comes_from_the_reports(self):
        self.make_plan(days_ago=2)
        for pain in (7, 5):
            self.send_report(pain_level=pain)
        self.bearer(self.doctor)
        reports = self.client.get('/api/patient-reports/', {'patient': self.patient.pk}).data['results']
        self.assertEqual([(item['pain_level'], item['postoperative_day']) for item in reports], [(5, 2), (7, 2)])
        plans = self.client.get('/api/treatment-plans/', {'patient': self.patient.pk}).data['results']
        self.assertEqual(plans[0]['postoperative_day'], 2)


class RF04ProcedureRegistrationTests(RequirementsTestCase):
    def consultation(self, **extra):
        self.bearer(self.doctor)
        payload = {
            'patient': self.patient.pk, 'medication_name': 'Paracetamol', 'active_ingredient': 'Paracetamol',
            'strength': '500 mg', 'dosage_form': 'Tableta', 'frequency': 'Cada 8 horas', 'duration': '3 días',
            'details': 'Compresas frías y dieta blanda las primeras 24 horas.', 'admission_reason': 'Control posquirúrgico',
            **extra,
        }
        payload.setdefault('clinical_data', sample_clinical_data(payload.get('clinical_procedure')))
        return self.client.post('/api/consultations/', payload, format='json')

    def test_ca01_surgery_type_is_selected_from_the_catalog(self):
        procedure = ClinicalProcedure.objects.get(code='COD-END-001')
        response = self.consultation(clinical_procedure=procedure.pk)
        self.assertEqual(response.status_code, 201)
        plan = TreatmentPlan.objects.get()
        self.assertEqual((plan.clinical_procedure, plan.procedure), (procedure, procedure.name))
        self.assertEqual(self.consultation(clinical_procedure=9999).status_code, 400)

    def test_catalog_offers_exodontia_and_endodontics(self):
        self.bearer(self.doctor)
        names = [item['name'] for item in self.client.get('/api/procedures/').data['results']]
        self.assertIn('Exodoncia simple', names)
        self.assertIn('Endodoncia (tratamiento de conducto)', names)

    def test_ca02_recovery_timeline_starts_at_surgery_date(self):
        surgery = timezone.localdate() - timedelta(days=2)
        procedure = ClinicalProcedure.objects.get(code='COD-MAX-014')
        self.consultation(clinical_procedure=procedure.pk, surgery_date=surgery.isoformat())
        self.client.force_authenticate(user=self.patient)
        plan = self.client.get('/api/treatment-plans/').data['results'][0]
        self.assertEqual(plan['surgery_date'], surgery.isoformat())
        self.assertEqual(plan['postoperative_day'], 2)
        self.assertEqual(plan['procedure_detail']['monitoring_days'], procedure.monitoring_days)
        self.assertEqual(self.send_report().data['postoperative_day'], 2)

    def test_hu05_ca01_patient_reads_the_exact_text(self):
        text = 'Compresas frías y dieta blanda las primeras 24 horas.'
        self.consultation(clinical_procedure=ClinicalProcedure.objects.first().pk)
        self.client.force_authenticate(user=self.patient)
        self.assertEqual(self.client.get('/api/prescriptions/').data['results'][0]['details'], text)
        self.assertEqual(self.client.get('/api/treatment-plans/').data['results'][0]['instructions'], text)

    def test_hu05_ca01_plan_keeps_the_dentist_text_verbatim(self):
        written = 'Evita masticar del lado tratado.\nToma el analgésico solo si hay dolor.'
        self.consultation(clinical_procedure=ClinicalProcedure.objects.first().pk, instructions=written)
        self.assertEqual(TreatmentPlan.objects.get().instructions, written)
        self.assertFalse(Prescription.objects.exclude(patient=self.patient).exists())

"""Pruebas de la API clínica: permisos, validaciones y flujos completos.

Los identificadores BUG-nn remiten a defectos ya corregidos: estas pruebas evitan que vuelvan.
"""
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import UserProfile

from .models import ClinicalEvolutionSummary, PatientReport, Prescription, TreatmentPlan

User = get_user_model()

VALID_CONSULTATION = {
    'medication_name': 'Paracetamol',
    'active_ingredient': 'Paracetamol',
    'strength': '500 mg',
    'dosage_form': 'Tableta',
    'frequency': 'Cada 8 horas',
    'duration': '3 días',
    'details': 'Tomar con agua y respetar los horarios.',
    'procedure': 'Exodoncia de tercer molar',
    'admission_reason': 'Dolor posterior al procedimiento',
}


class ApiTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('doctor', password='x', role=User.Roles.DOCTOR)
        cls.other_doctor = User.objects.create_user('other-doctor', password='x', role=User.Roles.DOCTOR)
        cls.admin = User.objects.create_user('admin', password='x', role=User.Roles.ADMIN)
        cls.patient = User.objects.create_user('patient', password='x', role=User.Roles.PATIENT)
        cls.other_patient = User.objects.create_user('other-patient', password='x', role=User.Roles.PATIENT)
        UserProfile.objects.create(user=cls.patient, primary_doctor=cls.doctor)
        UserProfile.objects.create(user=cls.other_patient)

    def login(self, user):
        self.client.force_authenticate(user=user)

    def allow_server_errors(self):
        """Convierte las excepciones no controladas en respuestas 500, como en producción."""
        self.client.raise_request_exception = False

    def prescription(self, doctor=None, patient=None, **extra):
        return Prescription.objects.create(
            doctor=doctor or self.doctor,
            patient=patient or self.patient,
            details=extra.pop('details', 'Reposo'),
            **extra,
        )

    def plan(self, patient=None, **extra):
        return TreatmentPlan.objects.create(
            patient=patient or self.patient,
            title=extra.pop('title', 'Compresas'),
            treatment_type=extra.pop('treatment_type', 'therapy'),
            schedule_description='Cada hora',
            instructions='Aplicar',
            **extra,
        )

    def plan_payload(self, patient=None, **extra):
        return {
            'patient': (patient or self.patient).pk,
            'title': 'Compresas',
            'treatment_type': 'therapy',
            'schedule_description': 'Cada hora',
            'instructions': 'Aplicar',
            **extra,
        }


class AuthenticationTests(ApiTestCase):
    def test_every_endpoint_requires_authentication(self):
        for url in (
            '/api/prescriptions/', '/api/patient-reports/', '/api/treatment-plans/',
            '/api/clinical-evolution/', '/api/patient-profile/', '/api/me/', '/api/patients/',
            '/api/account/', '/api/medications/search/',
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 401)
        for url in ('/api/consultations/', '/api/account/password/'):
            with self.subTest(url=url):
                self.assertEqual(self.client.post(url, {}, format='json').status_code, 401)

    def test_jwt_login_refresh_and_bearer_access(self):
        response = self.client.post('/api/token/', {'username': 'patient', 'password': 'x'}, format='json')
        self.assertEqual(response.status_code, 200)
        refreshed = self.client.post('/api/token/refresh/', {'refresh': response.data['refresh']}, format='json')
        self.assertEqual(refreshed.status_code, 200)

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {refreshed.data['access']}")
        me = self.client.get('/api/me/')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data['username'], 'patient')

    def test_wrong_credentials_and_tampered_token_are_rejected(self):
        response = self.client.post('/api/token/', {'username': 'patient', 'password': 'bad'}, format='json')
        self.assertEqual(response.status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer not.a.token')
        self.assertEqual(self.client.get('/api/me/').status_code, 401)

    def test_inactive_user_cannot_login(self):
        User.objects.create_user('inactive', password='x', is_active=False)
        response = self.client.post('/api/token/', {'username': 'inactive', 'password': 'x'}, format='json')
        self.assertEqual(response.status_code, 401)


class PrescriptionApiTests(ApiTestCase):
    def test_visibility_by_role(self):
        mine = self.prescription()
        other = self.prescription(doctor=self.other_doctor, patient=self.other_patient)
        cases = [
            (self.doctor, {mine.id}), (self.other_doctor, {other.id}),
            (self.patient, {mine.id}), (self.other_patient, {other.id}),
            (self.admin, {mine.id, other.id}),
        ]
        for user, expected in cases:
            with self.subTest(user=user.username):
                self.login(user)
                response = self.client.get('/api/prescriptions/')
                self.assertEqual({item['id'] for item in response.data['results']}, expected)

    def test_foreign_prescription_is_hidden_on_detail(self):
        foreign = self.prescription(doctor=self.other_doctor, patient=self.other_patient)
        for user in (self.doctor, self.patient):
            with self.subTest(user=user.username):
                self.login(user)
                self.assertEqual(self.client.get(f'/api/prescriptions/{foreign.id}/').status_code, 404)

    def test_active_filter(self):
        active = self.prescription()
        inactive = self.prescription(is_active=False)
        self.login(self.doctor)
        for value, expected in (('true', active.id), ('TRUE', active.id), ('false', inactive.id)):
            with self.subTest(value=value):
                results = self.client.get('/api/prescriptions/', {'active': value}).data['results']
                self.assertEqual([item['id'] for item in results], [expected])

    def test_results_are_paginated_newest_first(self):
        for _ in range(12):
            self.prescription()
        self.login(self.doctor)
        response = self.client.get('/api/prescriptions/')
        self.assertEqual(response.data['count'], 12)
        self.assertEqual(len(response.data['results']), 10)
        self.assertIsNotNone(response.data['next'])

    def test_doctor_cannot_be_forged_and_server_fields_are_ignored(self):
        self.login(self.doctor)
        response = self.client.post('/api/prescriptions/', {
            'patient': self.patient.pk,
            'details': 'Reposo relativo',
            'doctor': self.other_doctor.pk,
            'nlp_severity': 'Alta',
            'extracted_entities': [{'text': 'falso', 'label': 'X'}],
        }, format='json')
        self.assertEqual(response.status_code, 201)
        created = Prescription.objects.get(pk=response.data['id'])
        self.assertEqual(created.doctor, self.doctor)
        self.assertEqual(created.nlp_severity, 'Baja')
        self.assertNotIn({'text': 'falso', 'label': 'X'}, created.extracted_entities)

    def test_target_must_exist_and_be_a_patient(self):
        self.login(self.doctor)
        for target in (self.other_doctor.pk, 999999, 'abc', None):
            with self.subTest(target=target):
                response = self.client.post(
                    '/api/prescriptions/', {'patient': target, 'details': 'Reposo'}, format='json',
                )
                self.assertEqual(response.status_code, 400)

    def test_details_are_required(self):
        self.login(self.doctor)
        response = self.client.post('/api/prescriptions/', {'patient': self.patient.pk}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('details', response.data)

    def test_bug07_patient_cannot_edit_own_prescription(self):
        # BUG-07: solo perform_create comprueba el rol: el paciente puede reescribir su receta.
        prescription = self.prescription(details='Una tableta')
        self.login(self.patient)
        response = self.client.patch(
            f'/api/prescriptions/{prescription.id}/', {'details': 'Diez tabletas'}, format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_bug07_patient_cannot_delete_own_prescription(self):
        prescription = self.prescription()
        self.login(self.patient)
        self.assertEqual(self.client.delete(f'/api/prescriptions/{prescription.id}/').status_code, 403)

    def test_bug08_delete_is_a_soft_delete(self):
        # BUG-08: el modelo promete baja lógica ("en lugar de borrar registros médicos") y se borra la fila.
        prescription = self.prescription()
        self.login(self.doctor)
        self.client.delete(f'/api/prescriptions/{prescription.id}/')
        self.assertTrue(Prescription.objects.filter(pk=prescription.pk).exists())

    def test_bug09_editing_details_recalculates_severity(self):
        # BUG-09: PrescriptionViewSet no define perform_update: la severidad queda obsoleta.
        prescription = self.prescription(details='Reposo', nlp_severity='Baja')
        self.login(self.doctor)
        response = self.client.patch(
            f'/api/prescriptions/{prescription.id}/', {'details': 'Hemorragia urgente'}, format='json',
        )
        self.assertEqual(response.data['nlp_severity'], 'Alta')

    def test_bug10_guidance_uses_structured_medication_name(self):
        # BUG-10: la guía se busca solo en details e ignora medication_name.
        self.prescription(medication_name='Paracetamol', details='Tomar con agua y descansar.')
        self.login(self.patient)
        response = self.client.get('/api/prescriptions/')
        self.assertIsNotNone(response.data['results'][0]['medication_guidance'])

    def test_bug11_admin_cannot_prescribe(self):
        # BUG-11: /consultations/ exige Doctor, pero /prescriptions/ también admite al Admin.
        self.login(self.admin)
        response = self.client.post(
            '/api/prescriptions/', {'patient': self.patient.pk, 'details': 'Reposo'}, format='json',
        )
        self.assertEqual(response.status_code, 403)


class TreatmentPlanApiTests(ApiTestCase):
    def test_patient_only_sees_own_active_plans(self):
        active = self.plan()
        self.plan(is_active=False)
        self.plan(patient=self.other_patient)
        self.login(self.patient)
        results = self.client.get('/api/treatment-plans/').data['results']
        self.assertEqual([item['id'] for item in results], [active.id])

    def test_doctor_sees_assigned_or_prescribed_patients_only(self):
        assigned = self.plan()
        foreign = self.plan(patient=self.other_patient)
        self.login(self.doctor)
        ids = {item['id'] for item in self.client.get('/api/treatment-plans/').data['results']}
        self.assertEqual(ids, {assigned.id})

        self.prescription(patient=self.other_patient)
        ids = {item['id'] for item in self.client.get('/api/treatment-plans/').data['results']}
        self.assertEqual(ids, {assigned.id, foreign.id})

    def test_patient_cannot_create_or_update(self):
        plan = self.plan()
        self.login(self.patient)
        self.assertEqual(
            self.client.post('/api/treatment-plans/', self.plan_payload(), format='json').status_code, 403,
        )
        self.assertEqual(
            self.client.patch(f'/api/treatment-plans/{plan.id}/', {'title': 'x'}, format='json').status_code, 403,
        )

    def test_severity_is_computed_on_create_and_update(self):
        self.login(self.doctor)
        response = self.client.post(
            '/api/treatment-plans/',
            self.plan_payload(treatment_severity='Alta', care_recommendations='falso'),
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['treatment_severity'], 'Baja')
        self.assertNotEqual(response.data['care_recommendations'], 'falso')

        response = self.client.patch(
            f"/api/treatment-plans/{response.data['id']}/", {'procedure': 'Tercer molar'}, format='json',
        )
        self.assertEqual(response.data['treatment_severity'], 'Media')
        self.assertIn('compresas frías', response.data['care_recommendations'])

    def test_day_number_must_be_positive_and_type_valid(self):
        self.login(self.doctor)
        for extra in ({'day_number': 0}, {'day_number': -1}, {'treatment_type': 'magia'}):
            with self.subTest(extra=extra):
                response = self.client.post('/api/treatment-plans/', self.plan_payload(**extra), format='json')
                self.assertEqual(response.status_code, 400)

    def test_current_day(self):
        today = timezone.localdate()
        cases = [(None, 5, 5), (today, 1, 1), (today - timedelta(days=4), 1, 5), (today + timedelta(days=3), 1, 1)]
        for start_date, day_number, expected in cases:
            with self.subTest(start_date=start_date):
                plan = TreatmentPlan(start_date=start_date, day_number=day_number)
                self.assertEqual(plan.current_day, expected)

    def test_guidance_only_for_medication_plans(self):
        self.plan(title='Paracetamol', treatment_type='medication')
        self.plan(title='Paracetamol terapia', treatment_type='therapy')
        self.login(self.patient)
        results = self.client.get('/api/treatment-plans/').data['results']
        guidance = {item['treatment_type']: item['medication_guidance'] for item in results}
        self.assertEqual(guidance['medication']['name'], 'Paracetamol')
        self.assertIsNone(guidance['therapy'])

    def test_bug07_patient_cannot_delete_own_plan(self):
        plan = self.plan()
        self.login(self.patient)
        self.assertEqual(self.client.delete(f'/api/treatment-plans/{plan.id}/').status_code, 403)

    def test_bug12_plan_target_must_be_a_patient(self):
        # BUG-12: a diferencia de PrescriptionSerializer, aquí no hay validate_patient.
        self.login(self.doctor)
        response = self.client.post(
            '/api/treatment-plans/', self.plan_payload(patient=self.other_doctor), format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_bug13_doctor_cannot_take_over_a_patient_of_another_doctor(self):
        # BUG-13: crear un plan reasigna primary_doctor al autor sin comprobar nada.
        self.login(self.other_doctor)
        self.client.post('/api/treatment-plans/', self.plan_payload(), format='json')
        self.patient.profile.refresh_from_db()
        self.assertEqual(self.patient.profile.primary_doctor, self.doctor)

    def test_bug13_admin_does_not_become_primary_doctor(self):
        self.login(self.admin)
        self.client.post('/api/treatment-plans/', self.plan_payload(), format='json')
        self.patient.profile.refresh_from_db()
        self.assertEqual(self.patient.profile.primary_doctor, self.doctor)

    def test_bug14_plan_cannot_move_to_another_patient(self):
        plan = self.plan()
        self.login(self.doctor)
        response = self.client.patch(
            f'/api/treatment-plans/{plan.id}/', {'patient': self.other_patient.pk}, format='json',
        )
        self.assertEqual(response.status_code, 400)


class PatientReportApiTests(ApiTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        for patient in (cls.patient, cls.other_patient):
            TreatmentPlan.objects.create(
                patient=patient, title='Exodoncia', treatment_type='therapy',
                schedule_description='Cada hora', instructions='Reposo',
            )

    def report(self, user=None, **data):
        self.login(user or self.patient)
        payload = {'pain_level': 3, 'comparison': 'same', 'message': 'Sin novedades', **data}
        return self.client.post('/api/patient-reports/', payload, format='json')

    def test_pain_level_boundaries(self):
        for pain, expected in ((1, 201), (10, 201), (0, 201), (11, 400), (-1, 400), ('abc', 400), (None, 400)):
            with self.subTest(pain=pain):
                self.assertEqual(self.report(pain_level=pain).status_code, expected)

    def test_comparison_is_validated(self):
        self.assertEqual(self.report(comparison='otra').status_code, 400)
        self.assertEqual(self.report(comparison='').status_code, 400)

    def test_message_is_optional_and_stored_as_literal_text(self):
        self.assertEqual(self.report(message='').status_code, 201)
        script = '<script>alert(1)</script>'
        self.assertEqual(self.report(message=script).data['message'], script)

    def test_server_fields_cannot_be_forged(self):
        response = self.report(
            pain_level=1, risk_level='Alto', doctor_notified=True, recommendation='falso',
            nlp_severity='Alta', evolution_status='falso', patient=self.other_patient.pk,
        )
        self.assertEqual(response.status_code, 201)
        report = PatientReport.objects.get(pk=response.data['id'])
        self.assertEqual(report.patient, self.patient)
        self.assertEqual(report.risk_level, 'Bajo')
        self.assertFalse(report.doctor_notified)
        self.assertNotEqual(report.recommendation, 'falso')

    def test_only_patients_can_report(self):
        for user in (self.doctor, self.admin):
            with self.subTest(user=user.username):
                self.assertEqual(self.report(user=user).status_code, 403)

    def test_reports_are_immutable(self):
        report = self.report()
        url = f"/api/patient-reports/{report.data['id']}/"
        self.assertEqual(self.client.patch(url, {'pain_level': 1}, format='json').status_code, 405)
        self.assertEqual(self.client.put(url, {}, format='json').status_code, 405)
        self.assertEqual(self.client.delete(url).status_code, 405)

    def test_visibility_by_role(self):
        own = self.report().data['id']
        foreign = self.report(user=self.other_patient).data['id']
        self.prescription()
        cases = [
            (self.patient, {own}), (self.other_patient, {foreign}),
            (self.doctor, {own}), (self.other_doctor, set()), (self.admin, set()),
        ]
        for user, expected in cases:
            with self.subTest(user=user.username):
                self.login(user)
                results = self.client.get('/api/patient-reports/').data['results']
                self.assertEqual({item['id'] for item in results}, expected)

    def test_doctor_filter_by_patient(self):
        own = self.report().data['id']
        self.report(user=self.other_patient)
        self.prescription()
        self.prescription(patient=self.other_patient)
        self.login(self.doctor)
        results = self.client.get('/api/patient-reports/', {'patient': self.patient.pk}).data['results']
        self.assertEqual([item['id'] for item in results], [own])

    def test_several_prescriptions_do_not_duplicate_reports(self):
        self.report()
        self.prescription()
        self.prescription()
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/patient-reports/').data['count'], 1)

    def test_legacy_report_without_recommendation_is_evaluated_on_read(self):
        PatientReport.objects.create(patient=self.patient, pain_level=9, comparison='same')
        self.login(self.doctor)
        item = self.client.get('/api/patient-reports/').data['results'][0]
        self.assertEqual(item['risk_level'], 'Alto')
        self.assertTrue(item['recommendation'])

    def test_evolution_is_created_with_truncated_notes(self):
        self.report(message='x' * 500, pain_level=9, comparison='higher')
        evolution = ClinicalEvolutionSummary.objects.get()
        self.assertEqual(len(evolution.clinical_notes), 240)
        self.assertEqual(evolution.status_tag, 'Alerta de dolor')
        self.assertEqual(evolution.eva_recorded, 9)

    def test_evolution_status_tags(self):
        for comparison, tag in (('lower', 'En descenso'), ('same', 'Seguimiento')):
            with self.subTest(comparison=comparison):
                self.report(pain_level=2, comparison=comparison)
                self.assertEqual(ClinicalEvolutionSummary.objects.get().status_tag, tag)

    def test_evolution_visibility(self):
        self.report()
        self.report(user=self.other_patient)
        for user, expected in ((self.patient, 1), (self.other_patient, 1), (self.admin, 2), (self.doctor, 0)):
            with self.subTest(user=user.username):
                self.login(user)
                self.assertEqual(self.client.get('/api/clinical-evolution/').data['count'], expected)

    def test_evolution_is_read_only(self):
        self.login(self.admin)
        self.assertEqual(self.client.post('/api/clinical-evolution/', {}, format='json').status_code, 405)

    def test_bug15_reports_on_the_same_day_share_the_day_label(self):
        for _ in range(3):
            self.report()
        labels = list(ClinicalEvolutionSummary.objects.values_list('day_label', flat=True))
        self.assertEqual(labels, ['Día 0'])

    def test_bug16_primary_doctor_sees_reports_of_assigned_patient(self):
        # BUG-16: los informes filtran solo por receta; el médico asignado no ve alertas de su paciente.
        self.report(pain_level=10)
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/patient-reports/').data['count'], 1)

    def test_bug17_invalid_patient_filter_is_a_client_error(self):
        # BUG-17: ?patient=abc produce ValueError y responde 500.
        self.allow_server_errors()
        self.prescription()
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/patient-reports/', {'patient': 'abc'}).status_code, 400)

    def test_bug18_non_object_json_body_is_a_client_error(self):
        # BUG-18: to_internal_value llama data.copy() antes de validar el tipo y responde 500.
        self.allow_server_errors()
        self.login(self.patient)
        self.assertEqual(self.client.post('/api/patient-reports/', 5, format='json').status_code, 400)


class MedicationSearchApiTests(ApiTestCase):
    def test_patient_is_forbidden(self):
        self.login(self.patient)
        self.assertEqual(self.client.get('/api/medications/search/', {'q': 'para'}).status_code, 403)

    @patch('medical_monitor.medications.urlopen', side_effect=OSError)
    def test_staff_can_search_the_vademecum_without_internet(self, _urlopen):
        for user in (self.doctor, self.admin):
            with self.subTest(user=user.username):
                self.login(user)
                response = self.client.get('/api/medications/search/', {'q': 'paracet'})
                self.assertEqual(response.status_code, 200)
                item = response.data['items'][0]
                self.assertEqual((item['name'], item['source']), ('Paracetamol', 'Vademécum de la clínica'))
                self.assertIn('500 mg', [option['strength'] for option in item['presentations']])

    @patch('medical_monitor.medications.urlopen')
    def test_missing_query_does_not_call_network(self, urlopen):
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/medications/search/').data['items'], [])
        urlopen.assert_not_called()


class ConsultationApiTests(ApiTestCase):
    def consult(self, **overrides):
        self.login(self.doctor)
        payload = {'patient': self.patient.pk, **VALID_CONSULTATION, **overrides}
        return self.client.post('/api/consultations/', payload, format='json')

    def test_creates_prescription_and_plan_and_assigns_doctor(self):
        response = self.consult(side_effects='Náusea', clinical_notes='Sin alergias')
        self.assertEqual(response.status_code, 201)
        prescription = Prescription.objects.get()
        plan = TreatmentPlan.objects.get()
        self.assertEqual(prescription.doctor, self.doctor)
        self.assertEqual(plan.patient, self.patient)
        self.assertEqual(plan.start_date, timezone.localdate())
        self.assertEqual(plan.schedule_description, 'Cada 8 horas')
        self.assertEqual(plan.treatment_severity, 'Media')
        self.assertIn('compresas frías', plan.care_recommendations)

    def test_unassigned_patient_gets_the_doctor_as_primary(self):
        self.assertEqual(self.consult(patient=self.other_patient.pk).status_code, 201)
        self.other_patient.profile.refresh_from_db()
        self.assertEqual(self.other_patient.profile.primary_doctor, self.doctor)

    def test_only_doctor_can_consult(self):
        for user in (self.patient, self.admin):
            with self.subTest(user=user.username):
                self.login(user)
                response = self.client.post('/api/consultations/', VALID_CONSULTATION, format='json')
                self.assertEqual(response.status_code, 403)

    def test_field_validation(self):
        cases = {
            'medication_name': ['', 'x', 'x' * 121],
            'active_ingredient': [''],
            'strength': ['', 'x' * 41],
            'dosage_form': [''],
            'frequency': [''],
            'duration': ['', '3', 'tres días', '1000 días', '3 años'],
            'details': ['', 'corto'],
            'procedure': ['', 'ab', 'x' * 161],
            'admission_reason': ['', 'abcd', 'x' * 241],
            'side_effects': ['x' * 501],
            'clinical_notes': ['x' * 1001],
            'start_date': ['ayer', '2026-13-45', (timezone.localdate() + timedelta(days=1)).isoformat()],
        }
        for field, values in cases.items():
            for value in values:
                with self.subTest(field=field, value=value[:20]):
                    response = self.consult(**{field: value})
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.data)
        self.assertEqual(Prescription.objects.count(), 0)
        self.assertEqual(TreatmentPlan.objects.count(), 0)

    def test_field_limits_are_accepted(self):
        response = self.consult(
            medication_name='x' * 120, strength='x' * 40, side_effects='x' * 500,
            clinical_notes='x' * 1000, procedure='x' * 160, admission_reason='x' * 240,
            start_date=timezone.localdate().isoformat(),
        )
        self.assertEqual(response.status_code, 201)

    def test_duration_units(self):
        for duration in ('1 día', '3 días', '2 semanas', '1 mes', '12 MESES', '999días'):
            with self.subTest(duration=duration):
                self.assertEqual(self.consult(duration=duration).status_code, 201)

    def test_patient_must_be_valid(self):
        for target in ('', None, 999999, 'abc', self.other_doctor.pk):
            with self.subTest(target=target):
                self.assertEqual(self.consult(patient=target).status_code, 400)
        self.assertEqual(TreatmentPlan.objects.count(), 0)

    def test_too_long_serializer_field_is_rejected_cleanly(self):
        for field, limit in (('active_ingredient', 120), ('dosage_form', 60), ('frequency', 120)):
            with self.subTest(field=field):
                self.assertEqual(self.consult(**{field: 'x' * (limit + 1)}).status_code, 400)

    def test_failure_creating_plan_rolls_back_the_prescription(self):
        self.allow_server_errors()
        with patch('medical_monitor.views.TreatmentPlan.objects.create', side_effect=RuntimeError):
            self.assertEqual(self.consult().status_code, 500)
        self.assertEqual(Prescription.objects.count(), 0)

    def test_bug19_zero_duration_is_rejected(self):
        # BUG-19: la expresión regular acepta "0 días"; el formulario sí lo rechaza.
        self.assertEqual(self.consult(duration='0 días').status_code, 400)

    def test_bug18_non_object_json_body_is_a_client_error(self):
        self.allow_server_errors()
        self.login(self.doctor)
        self.assertEqual(self.client.post('/api/consultations/', [1], format='json').status_code, 400)

    def test_bug13_consultation_does_not_take_over_a_patient(self):
        self.login(self.other_doctor)
        self.client.post(
            '/api/consultations/', {'patient': self.patient.pk, **VALID_CONSULTATION}, format='json',
        )
        self.patient.profile.refresh_from_db()
        self.assertEqual(self.patient.profile.primary_doctor, self.doctor)


class SeedDemoCommandTests(ApiTestCase):
    def test_replaces_data_and_keeps_superusers(self):
        superuser = User.objects.create_superuser('root', password='x')
        self.prescription()
        call_command('seed_demo', force=True, stdout=StringIO())

        self.assertTrue(User.objects.filter(pk=superuser.pk).exists())
        self.assertFalse(User.objects.filter(username='patient').exists())
        self.assertEqual(Prescription.objects.count(), 2)
        # 2 planes quirúrgicos con receta + 3 de otras especialidades (ortodoncia, endodoncia, implante).
        self.assertEqual(TreatmentPlan.objects.count(), 5)
        self.assertEqual(PatientReport.objects.count(), 2 + 3 * 2)
        self.assertEqual(ClinicalEvolutionSummary.objects.count(), 2)

    def test_can_run_twice_and_credentials_work(self):
        call_command('seed_demo', force=True, stdout=StringIO())
        call_command('seed_demo', force=True, stdout=StringIO())
        response = self.client.post(
            '/api/token/', {'username': 'doctor.demo', 'password': 'DoctorDemo2026!'}, format='json',
        )
        self.assertEqual(response.status_code, 200)

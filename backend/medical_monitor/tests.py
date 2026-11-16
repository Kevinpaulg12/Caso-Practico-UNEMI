from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .services import analyze_medical_text, evaluate_patient_status, evaluate_treatment_plan
from .models import MedicationGuide, PatientReport, Prescription, TreatmentPlan
from .models import ClinicalEvolutionSummary


User = get_user_model()


def give_active_plan(patient):
    return TreatmentPlan.objects.create(
        patient=patient, title='Exodoncia', treatment_type='therapy',
        schedule_description='Según indicación', instructions='Reposo',
    )


class MedicalTextAnalysisTests(APITestCase):
    def test_medication_guide_is_returned_for_prescription(self):
        doctor = User.objects.create_user(
            username='doctor-medication-guide',
            password='test-password',
            role=User.Roles.DOCTOR,
        )
        patient = User.objects.create_user(
            username='patient-medication-guide',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=patient)
        prescription = Prescription.objects.create(
            doctor=doctor,
            patient=patient,
            details='Paracetamol 500 mg cada 8 horas',
        )

        response = self.client.get('/api/prescriptions/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['id'], prescription.id)
        self.assertEqual(
            response.data['results'][0]['medication_guidance']['name'],
            'Paracetamol',
        )

    def test_treatment_for_third_molar_gets_basic_care(self):
        result = evaluate_treatment_plan(
            'Control postoperatorio',
            'Extracción de tercer molar',
            'Reposo y medicación según indicación',
            'Inflamación esperada',
        )

        self.assertEqual(result['severity'], 'Media')
        self.assertIn('compresas frías', result['recommendations'])

    def test_evaluates_patient_risk_and_recommendation(self):
        result = evaluate_patient_status(
            pain_level=8,
            comparison='higher',
            message='El dolor es intenso y tengo fiebre alta.',
        )

        self.assertEqual(result['risk_level'], 'Alto')
        self.assertEqual(result['evolution_status'], 'Requiere revisión')
        self.assertTrue(result['doctor_notified'])
        self.assertTrue(result['recommendation'])

    def test_detects_high_severity(self):
        result = analyze_medical_text('Paciente presenta fiebre alta y dolor intenso.')

        self.assertEqual(result['severity'], 'Alta')
        self.assertIsInstance(result['entities'], list)

    def test_detects_medium_severity(self):
        result = analyze_medical_text('Control moderado cada 8 horas.')

        self.assertEqual(result['severity'], 'Media')

    def test_defaults_to_low_severity(self):
        result = analyze_medical_text('Mantener hidratación y reposo.')

        self.assertEqual(result['severity'], 'Baja')

    def test_saves_nlp_results_when_creating_prescription(self):
        doctor = User.objects.create_user(
            username='doctor-nlp',
            password='test-password',
            role=User.Roles.DOCTOR,
        )
        patient = User.objects.create_user(
            username='patient-nlp',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=doctor)

        response = self.client.post(
            '/api/prescriptions/',
            {
                'patient': patient.pk,
                'details': 'Paciente presenta hemorragia y requiere atención urgente.',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['nlp_severity'], 'Alta')
        self.assertIsInstance(response.data['extracted_entities'], list)

    def test_patient_report_validates_pain_and_persists_nlp(self):
        patient = User.objects.create_user(
            username='patient-report',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=patient)
        give_active_plan(patient)

        response = self.client.post(
            '/api/patient-reports/',
            {
                'pain_level': 8,
                'comparison': 'higher',
                'message': 'Tengo dolor intenso y fiebre alta.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['nlp_severity'], 'Alta')
        self.assertEqual(response.data['risk_level'], 'Alto')
        self.assertTrue(response.data['doctor_notified'])
        self.assertIn('doctor', response.data['recommendation'])
        self.assertEqual(PatientReport.objects.get().patient, patient)

    def test_patient_report_rejects_invalid_pain_level(self):
        patient = User.objects.create_user(
            username='patient-invalid-report',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=patient)
        give_active_plan(patient)

        response = self.client.post(
            '/api/patient-reports/',
            {'pain_level': 11, 'comparison': 'same', 'message': 'Sin novedades.'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)

    def test_patient_report_accepts_eva_alias_and_creates_evolution(self):
        patient = User.objects.create_user(
            username='patient-eva-alias',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=patient)
        give_active_plan(patient)

        response = self.client.post(
            '/api/patient-reports/',
            {
                'eva_score': 9,
                'comparison': 'higher',
                'message': 'Tengo dolor intenso y necesito ayuda.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['eva_score'], 9)
        self.assertTrue(response.data['doctor_notified'])
        self.assertEqual(ClinicalEvolutionSummary.objects.count(), 1)

    def test_patient_only_sees_own_prescriptions(self):
        patient = User.objects.create_user(
            username='patient-own-data',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        other_patient = User.objects.create_user(
            username='patient-other-data',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        doctor = User.objects.create_user(
            username='doctor-own-data',
            password='test-password',
            role=User.Roles.DOCTOR,
        )
        from .models import Prescription
        Prescription.objects.create(
            doctor=doctor,
            patient=patient,
            details='Indicación propia',
        )
        Prescription.objects.create(
            doctor=doctor,
            patient=other_patient,
            details='Indicación ajena',
        )
        self.client.force_authenticate(user=patient)

        response = self.client.get('/api/prescriptions/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['details'], 'Indicación propia')

    def test_patient_cannot_create_prescription(self):
        patient = User.objects.create_user(
            username='patient-cannot-prescribe',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=patient)

        response = self.client.post(
            '/api/prescriptions/',
            {'patient': patient.pk, 'details': 'No permitido'},
            format='json',
        )

        self.assertEqual(response.status_code, 403)

    def test_doctor_can_create_treatment_with_admission_reason(self):
        doctor = User.objects.create_user(
            username='doctor-treatment-record',
            password='test-password',
            role=User.Roles.DOCTOR,
        )
        patient = User.objects.create_user(
            username='patient-treatment-record',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=doctor)
        response = self.client.post(
            '/api/treatment-plans/',
            {
                'patient': patient.pk,
                'title': 'Paracetamol 500 mg',
                'treatment_type': 'medication',
                'schedule_description': 'Cada 8 horas',
                'instructions': 'Tomar según la indicación.',
                'procedure': 'Extracción de tercer molar',
                'admission_reason': 'Dolor e inflamación posterior a cirugía',
                'clinical_notes': 'Control inicial.',
                'day_number': 1,
                'start_date': '2026-10-29',
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['admission_reason'], 'Dolor e inflamación posterior a cirugía')

    def test_consultation_creates_structured_prescription_and_active_treatment(self):
        doctor = User.objects.create_user(
            username='doctor-consultation',
            password='test-password',
            role=User.Roles.DOCTOR,
        )
        patient = User.objects.create_user(
            username='patient-consultation',
            password='test-password',
            role=User.Roles.PATIENT,
        )
        self.client.force_authenticate(user=doctor)

        response = self.client.post(
            '/api/consultations/',
            {
                'patient': patient.pk,
                'medication_name': 'Paracetamol',
                'active_ingredient': 'Paracetamol',
                'strength': '500 mg',
                'dosage_form': 'Tableta',
                'frequency': 'Cada 8 horas',
                'duration': '3 días',
                'details': 'Tomar con agua y respetar los horarios indicados.',
                'procedure': 'Exodoncia de tercer molar',
                'admission_reason': 'Dolor posterior al procedimiento',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['prescription']['strength'], '500 mg')
        self.assertEqual(response.data['treatment']['medication_name'], 'Paracetamol')
        self.assertTrue(TreatmentPlan.objects.filter(patient=patient, is_active=True).exists())

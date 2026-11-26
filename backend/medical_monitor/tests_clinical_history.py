"""Historia clínica longitudinal compartida entre los odontólogos de la clínica."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User, UserProfile

from .models import AuditEvent, ClinicalProcedure, ControlVisit, PatientReport, Prescription, TreatmentPlan


class ClinicalHistoryTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.laura = User.objects.create_user('laura', password='x', role=User.Roles.DOCTOR, first_name='Laura', last_name='Mora')
        cls.pedro = User.objects.create_user('pedro', password='x', role=User.Roles.DOCTOR, first_name='Pedro', last_name='Ruiz')
        cls.admin = User.objects.create_user('admin', password='x', role=User.Roles.ADMIN)
        cls.patient = User.objects.create_user('paciente.1712345678', password='x', role=User.Roles.PATIENT,
                                               first_name='Ana', last_name='López')
        UserProfile.objects.create(user=cls.patient, primary_doctor=cls.laura, national_id='1712345678',
                                   birth_date=timezone.localdate() - timedelta(days=365 * 30))
        today = timezone.localdate()
        # Un tratamiento antiguo con Laura: amoxicilina y una alerta roja.
        cls.old = TreatmentPlan.objects.create(
            patient=cls.patient, title='Amoxicilina', treatment_type='medication', schedule_description='Cada 8 horas',
            instructions='Dieta blanda', procedure='Exodoncia simple', clinical_procedure=ClinicalProcedure.objects.get(code='COD-MAX-001'),
            start_date=today - timedelta(days=200), is_active=False, teeth=[38],
        )
        Prescription.objects.create(doctor=cls.laura, patient=cls.patient, treatment_plan=cls.old, details='Amoxicilina 500 mg',
                                    medication_name='Amoxicilina', strength='500 mg', frequency='Cada 8 horas', is_active=False)
        for pain, risk in ((4, 'Bajo'), (9, 'Alto')):
            PatientReport.objects.create(patient=cls.patient, treatment_plan=cls.old, pain_level=pain, comparison='higher',
                                         risk_level=risk, message='Me duele mucho',
                                         extracted_entities=[{'label': 'SINTOMA', 'category': 'Dolor', 'negated': False}])
        # El tratamiento actual lo lleva Pedro.
        cls.current = TreatmentPlan.objects.create(
            patient=cls.patient, title='Brackets', treatment_type='therapy', schedule_description='Controles',
            instructions='Cepillado', procedure='Ortodoncia con brackets', clinical_procedure=ClinicalProcedure.objects.get(code='ORT-001'),
            start_date=today - timedelta(days=30), clinical_data={'aparato': 'Brackets metálicos'},
        )
        ControlVisit.objects.create(treatment_plan=cls.current, doctor=cls.pedro, date=today - timedelta(days=2), notes='Cambio de arco')

    def history(self, user):
        self.client.force_authenticate(user=user)
        return self.client.get(f'/api/patients/{self.patient.pk}/clinical-history/')

    def test_any_dentist_of_the_clinic_sees_the_whole_history(self):
        # Pedro no es el odontólogo asignado ni recetó nada en el tratamiento anterior.
        data = self.history(self.pedro).data
        self.assertEqual(data['patient']['full_name'], 'Ana López')
        self.assertEqual((data['patient']['age'], data['patient']['primary_doctor']), (self.patient.age, 'Laura Mora'))
        self.assertEqual(data['summary']['treatments'], 2)
        self.assertEqual(data['summary']['active_treatments'], 1)
        self.assertEqual(set(data['summary']['dentists']), {'Laura Mora', 'Pedro Ruiz'})
        self.assertEqual(data['summary']['frequent_symptoms'], [{'label': 'Dolor', 'days': 2}])
        # Lo más reciente primero.
        current, old = data['treatments']
        self.assertEqual((current['plan']['procedure'], current['dentists']), ('Ortodoncia con brackets', ['Pedro Ruiz']))
        self.assertEqual(current['plan']['clinical_data_display'], [{'label': 'Tipo de aparato', 'value': 'Brackets metálicos'}])
        self.assertIn('control', [event['type'] for event in current['events']])
        self.assertEqual(old['outcome'], {'days_with_followup': 1, 'max_pain': 9, 'last_pain': 9, 'red_alerts': 1, 'yellow_alerts': 0})
        # El colega ve qué se recetó y que ese tratamiento terminó con alertas rojas.
        medication = data['medications'][0]
        self.assertEqual((medication['name'], medication['doctor'], medication['red_alerts_in_treatment']), ('Amoxicilina', 'Laura Mora', 1))

    def test_every_access_is_audited(self):
        self.history(self.pedro)
        event = AuditEvent.objects.get(module='Historia clínica')
        self.assertEqual((event.actor, event.action), (self.pedro, 'Consultó la historia clínica de paciente.1712345678'))

    def test_only_dentists_and_only_patients(self):
        self.assertEqual(self.history(self.admin).status_code, 403)
        self.assertEqual(self.history(self.patient).status_code, 403)
        self.client.force_authenticate(user=self.pedro)
        self.assertEqual(self.client.get(f'/api/patients/{self.laura.pk}/clinical-history/').status_code, 404)
        self.assertFalse(AuditEvent.objects.filter(module='Historia clínica').exists())

    def test_the_query_count_does_not_grow_with_each_treatment(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        self.client.force_authenticate(user=self.pedro)
        with CaptureQueriesContext(connection) as before:
            self.client.get(f'/api/patients/{self.patient.pk}/clinical-history/')
        for index in range(3):
            TreatmentPlan.objects.create(patient=self.patient, title=f'T{index}', treatment_type='therapy',
                                         schedule_description='x', instructions='x')
        with CaptureQueriesContext(connection) as after:
            self.client.get(f'/api/patients/{self.patient.pk}/clinical-history/')
        # build_history consulta cada tratamiento por separado: se acota el crecimiento por tratamiento.
        self.assertLessEqual(len(after) - len(before), 3 * 12)

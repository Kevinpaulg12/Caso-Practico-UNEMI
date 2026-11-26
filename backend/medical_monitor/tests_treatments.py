"""Alta médica con varios tratamientos, edición de tratamientos en curso e historial unificado."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User, UserProfile

from .models import PatientReport, Prescription, TreatmentChange, TreatmentPlan


class TreatmentTestCase(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('doctor', password='x', role=User.Roles.DOCTOR, first_name='Laura')
        cls.other_doctor = User.objects.create_user('other', password='x', role=User.Roles.DOCTOR)
        cls.patient = User.objects.create_user('patient', password='x', role=User.Roles.PATIENT, first_name='Ana', last_name='Ruiz')
        UserProfile.objects.create(user=cls.patient, primary_doctor=cls.doctor, national_id='1712345678')

    def login(self, user):
        self.client.force_authenticate(user=user)

    def consult(self, medication='Paracetamol', frequency='Cada 8 horas', days_ago=0, **extra):
        """Registra una consulta completa (receta + tratamiento) como lo hace la interfaz."""
        self.login(self.doctor)
        payload = {
            'patient': self.patient.pk, 'medication_name': medication, 'active_ingredient': medication,
            'strength': '500 mg', 'dosage_form': 'Tableta', 'frequency': frequency, 'duration': '3 días',
            'procedure': 'Exodoncia simple', 'admission_reason': 'Dolor en molar inferior',
            'details': f'{medication} 500 mg. tableta. cada 8 horas. durante 3 días',
            'instructions': 'Compresas frías 15 minutos cada hora.',
            'surgery_date': str(timezone.localdate() - timedelta(days=days_ago)), **extra,
        }
        response = self.client.post('/api/consultations/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return TreatmentPlan.objects.get(pk=response.data['treatment']['id'])

    def report(self, pain=4, message='Me duele un poco'):
        self.login(self.patient)
        response = self.client.post(
            '/api/patient-reports/', {'pain_level': pain, 'comparison': 'same', 'message': message}, format='json',
        )
        return response

    def discharge(self):
        self.login(self.doctor)
        return self.client.post(f'/api/patients/{self.patient.pk}/discharge/')

    def patient_portal(self):
        self.login(self.patient)
        prescriptions = self.client.get('/api/prescriptions/').data['results']
        plans = self.client.get('/api/treatment-plans/').data['results']
        return prescriptions, plans


class DischargeAllTreatmentsTests(TreatmentTestCase):
    """Bug: con dos tratamientos activos, el alta dejaba las indicaciones del segundo en el portal."""

    def setUp(self):
        self.first = self.consult('Paracetamol', days_ago=5)
        # El segundo tratamiento se registra en otro momento, días después.
        TreatmentPlan.objects.filter(pk=self.first.pk).update(created_at=timezone.now() - timedelta(days=5))
        self.second = self.consult('Ibuprofeno', frequency='Cada 12 horas', days_ago=1)

    def test_before_discharge_the_portal_shows_both_treatments(self):
        prescriptions, plans = self.patient_portal()
        self.assertEqual({item['medication_name'] for item in prescriptions}, {'Paracetamol', 'Ibuprofeno'})
        self.assertEqual(len(plans), 2)

    def test_discharge_closes_every_active_treatment_and_prescription(self):
        care_plan = TreatmentPlan.objects.create(
            patient=self.patient, title='Dieta blanda', treatment_type='diet', schedule_description='x', instructions='x',
        )
        response = self.discharge()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'plans_closed': 3, 'prescriptions_closed': 2})
        self.assertFalse(TreatmentPlan.objects.filter(patient=self.patient, is_active=True).exists())
        self.assertFalse(Prescription.objects.filter(patient=self.patient, is_active=True).exists())
        for plan in (self.first, self.second, care_plan):
            with self.subTest(plan=plan.title):
                plan.refresh_from_db()
                self.assertFalse(plan.is_active)
                self.assertTrue(plan.changes.filter(kind=TreatmentChange.Kind.DISCHARGE).exists())

    def test_after_discharge_the_portal_shows_no_indications(self):
        self.discharge()
        prescriptions, plans = self.patient_portal()
        self.assertEqual(prescriptions, [])
        self.assertEqual(plans, [])
        self.assertEqual(self.report().status_code, 400)

    def test_after_discharge_the_patient_still_sees_their_past_treatments(self):
        self.discharge()
        self.login(self.patient)
        plans = self.client.get('/api/treatment-plans/', {'include_closed': 'true'}).data['results']
        prescriptions = self.client.get('/api/prescriptions/', {'include_closed': 'true'}).data['results']
        # Lo más reciente primero, y todo cerrado.
        self.assertEqual([item['id'] for item in plans], [self.second.pk, self.first.pk])
        self.assertFalse(any(item['is_active'] for item in plans + prescriptions))
        self.assertEqual({item['medication_name'] for item in prescriptions}, {'Paracetamol', 'Ibuprofeno'})
        # Las notas clínicas internas no llegan al paciente.
        self.assertNotIn('clinical_notes', plans[0])
        # Nunca los de otro paciente.
        other = User.objects.create_user('other-patient', password='x', role=User.Roles.PATIENT)
        self.login(other)
        self.assertEqual(self.client.get('/api/treatment-plans/', {'include_closed': 'true'}).data['results'], [])

    def test_after_discharge_the_patient_leaves_the_dashboard_and_appears_in_history(self):
        self.discharge()
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/patients/').data, [])
        closed = self.client.get('/api/discharges/').data
        self.assertEqual({item['id'] for item in closed}, {self.first.pk, self.second.pk})
        self.assertEqual(self.client.get('/api/patients/', {'search': '1712345678'}).data[0]['id'], self.patient.pk)

    def test_discharge_twice_is_rejected(self):
        self.assertEqual(self.discharge().status_code, 200)
        self.assertEqual(self.discharge().status_code, 400)

    def test_a_new_consultation_after_discharge_starts_a_new_treatment(self):
        self.discharge()
        third = self.consult('Amoxicilina')
        prescriptions, plans = self.patient_portal()
        self.assertEqual([item['medication_name'] for item in prescriptions], ['Amoxicilina'])
        self.assertEqual([item['id'] for item in plans], [third.pk])
        self.login(self.doctor)
        self.assertEqual([item['id'] for item in self.client.get('/api/patients/').data], [self.patient.pk])

    def test_discharge_scope_and_roles(self):
        self.login(self.other_doctor)
        self.assertEqual(self.client.post(f'/api/patients/{self.patient.pk}/discharge/').status_code, 404)
        self.login(self.patient)
        self.assertEqual(self.client.post(f'/api/patients/{self.patient.pk}/discharge/').status_code, 403)
        self.assertEqual(TreatmentPlan.objects.filter(patient=self.patient, is_active=True).count(), 2)


class EditTreatmentTests(TreatmentTestCase):
    def setUp(self):
        self.plan = self.consult()
        self.url = f'/api/treatment-plans/{self.plan.pk}/'

    def edit(self, user=None, **data):
        self.login(user or self.doctor)
        return self.client.patch(self.url, data, format='json')

    def test_consultation_links_the_prescription_to_its_treatment(self):
        self.assertEqual(list(self.plan.prescriptions.values_list('medication_name', flat=True)), ['Paracetamol'])

    def test_editing_instructions_is_recorded_without_a_new_prescription(self):
        response = self.edit(instructions='Dieta blanda y compresas frías durante 48 horas.')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['instructions'], 'Dieta blanda y compresas frías durante 48 horas.')
        self.assertEqual(self.plan.prescriptions.count(), 1)
        self.assertEqual(list(self.plan.changes.values_list('summary', flat=True)), ['Indicaciones actualizadas'])

    def test_changing_the_medication_issues_a_new_prescription_and_keeps_the_old_one(self):
        response = self.edit(frequency='Cada 6 horas', duration='5 días')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['schedule_description'], 'Cada 6 horas')
        old, new = self.plan.prescriptions.order_by('created_at', 'id')
        self.assertFalse(old.is_active)
        self.assertTrue(new.is_active)
        self.assertEqual((new.frequency, new.duration), ('Cada 6 horas', '5 días'))
        self.assertIn('cada 6 horas', new.details)
        self.assertEqual(
            self.plan.changes.get().summary, 'Frecuencia: Cada 8 horas → Cada 6 horas; Duración: 3 días → 5 días',
        )
        prescriptions, _ = self.patient_portal()
        self.assertEqual([item['id'] for item in prescriptions], [new.pk])

    def test_renaming_the_medication_updates_the_title(self):
        self.assertEqual(self.edit(medication_name='Ibuprofeno').data['title'], 'Ibuprofeno')
        self.assertEqual(self.plan.prescriptions.get(is_active=True).medication_name, 'Ibuprofeno')

    def test_saving_without_changes_records_nothing(self):
        self.assertEqual(self.edit(frequency='Cada 8 horas').status_code, 200)
        self.assertFalse(self.plan.changes.exists())
        self.assertEqual(self.plan.prescriptions.count(), 1)

    def test_invalid_values_are_rejected(self):
        for data, field in (
            ({'duration': 'mucho'}, 'duration'),
            ({'instructions': 'corto'}, 'instructions'),
            ({'medication_name': 'x'}, 'medication_name'),
            ({'frequency': ' '}, 'frequency'),
            ({'is_active': False}, 'is_active'),
        ):
            with self.subTest(field=field):
                response = self.edit(**data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)
        self.assertFalse(self.plan.changes.exists())

    def test_a_closed_treatment_cannot_be_edited(self):
        self.discharge()
        response = self.edit(instructions='Nuevas indicaciones para el paciente.')
        self.assertEqual(response.status_code, 400)
        self.assertIn('cerrado', str(response.data['detail']))

    def test_only_the_treating_doctor_can_edit(self):
        self.assertEqual(self.edit(user=self.other_doctor, frequency='Cada 6 horas').status_code, 404)
        self.assertEqual(self.edit(user=self.patient, frequency='Cada 6 horas').status_code, 403)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.frequency, 'Cada 8 horas')


class TreatmentHistoryTests(TreatmentTestCase):
    def history(self, plan, user=None):
        self.login(user or self.doctor)
        return self.client.get(f'/api/treatment-plans/{plan.pk}/history/')

    def test_timeline_joins_medications_changes_reports_and_discharge(self):
        plan = self.consult()
        self.assertEqual(self.report(pain=6, message='Tengo mucho dolor y sangrado').status_code, 201)
        self.login(self.doctor)
        self.client.patch(f'/api/treatment-plans/{plan.pk}/', {'frequency': 'Cada 6 horas'}, format='json')
        self.report(pain=2, message='Ya no me duele')
        self.discharge()

        response = self.history(plan)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['patient']['full_name'], 'Ana Ruiz')
        events = response.data['events']
        self.assertEqual(
            [event['type'] for event in events],
            ['start', 'medication', 'report', 'change', 'medication', 'report', 'discharge'],
        )
        first_medication, second_medication = (event for event in events if event['type'] == 'medication')
        self.assertFalse(first_medication['is_active'])
        self.assertEqual(second_medication['frequency'], 'Cada 6 horas')
        first_report = next(event for event in events if event['type'] == 'report')
        self.assertEqual(first_report['pain_level'], 6)
        self.assertIn('Sangrado', {item['category'] for item in first_report['symptoms']})
        self.assertEqual(events[0]['admission_reason'], 'Dolor en molar inferior')

    def test_reports_belong_to_the_treatment_active_when_they_were_sent(self):
        first = self.consult('Paracetamol')
        self.report(pain=5)
        self.discharge()
        second = self.consult('Ibuprofeno')
        self.report(pain=3)
        self.assertEqual(PatientReport.objects.get(pain_level=5).treatment_plan, first)
        self.assertEqual(PatientReport.objects.get(pain_level=3).treatment_plan, second)
        pains = [event['pain_level'] for event in self.history(second).data['events'] if event['type'] == 'report']
        self.assertEqual(pains, [3])

    def test_only_the_treating_doctor_sees_the_history(self):
        plan = self.consult()
        self.assertEqual(self.history(plan, user=self.other_doctor).status_code, 404)
        self.assertEqual(self.history(plan, user=self.patient).status_code, 403)


class SeveralMedicationsTests(TreatmentTestCase):
    """Una receta puede llevar uno o más medicamentos."""

    def medication(self, name, frequency='Cada 8 horas', duration='3 días'):
        return {'medication_name': name, 'active_ingredient': name, 'strength': '500 mg', 'dosage_form': 'Tableta',
                'frequency': frequency, 'duration': duration}

    def consult_with(self, items, **extra):
        self.login(self.doctor)
        return self.client.post('/api/consultations/', {
            'patient': self.patient.pk, 'procedure': 'Exodoncia simple', 'admission_reason': 'Dolor en molar inferior',
            'instructions': 'Compresas frías 15 minutos cada hora.', 'medications': items,
            'surgery_date': str(timezone.localdate()), **extra,
        }, format='json')

    def test_a_consultation_issues_one_prescription_per_medication(self):
        response = self.consult_with([self.medication('Amoxicilina', duration='7 días'), self.medication('Ibuprofeno', 'Cada 12 horas')])
        self.assertEqual(response.status_code, 201, response.data)
        plan = TreatmentPlan.objects.get(pk=response.data['treatment']['id'])
        # El primero es el principal del plan.
        self.assertEqual((plan.title, plan.medication_name), ('Amoxicilina', 'Amoxicilina'))
        self.assertEqual([item['medication_name'] for item in response.data['prescriptions']], ['Amoxicilina', 'Ibuprofeno'])
        active = plan.prescriptions.filter(is_active=True)
        self.assertEqual(active.count(), 2)
        self.assertIn('ibuprofeno 500 mg tableta cada 12 horas durante 3 días', active.get(medication_name='Ibuprofeno').details.lower())
        # El paciente ve las dos recetas y la explicación las incluye.
        prescriptions, _ = self.patient_portal()
        self.assertEqual({item['medication_name'] for item in prescriptions}, {'Amoxicilina', 'Ibuprofeno'})
        from .ai.explain import local_explanation, source_text
        steps = local_explanation(plan, source_text(plan)).medicacion
        self.assertEqual([step.nombre for step in steps], ['Amoxicilina 500 mg', 'Ibuprofeno 500 mg'])

    def test_each_medication_is_validated_in_its_position(self):
        broken = {**self.medication('Ibuprofeno'), 'duration': 'mucho'}
        response = self.consult_with([self.medication('Amoxicilina'), broken, self.medication('amoxicilina')])
        self.assertEqual(response.status_code, 400)
        errors = response.data['medications']
        self.assertEqual(errors[0], {})
        self.assertIn('duration', errors[1])
        self.assertIn('ya está en la receta', errors[2]['medication_name'])
        for items in ([], [self.medication(f'Fármaco {index}') for index in range(11)]):
            with self.subTest(count=len(items)):
                self.assertEqual(self.consult_with(items).status_code, 400)
        self.assertFalse(TreatmentPlan.objects.exists())

    def test_editing_the_main_medication_keeps_the_others(self):
        plan_id = self.consult_with([self.medication('Amoxicilina'), self.medication('Ibuprofeno')]).data['treatment']['id']
        response = self.client.patch(f'/api/treatment-plans/{plan_id}/', {'frequency': 'Cada 6 horas'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        active = Prescription.objects.filter(treatment_plan_id=plan_id, is_active=True)
        self.assertEqual({(item.medication_name, item.frequency) for item in active},
                         {('Amoxicilina', 'Cada 6 horas'), ('Ibuprofeno', 'Cada 8 horas')})

    def test_editing_the_treatment_can_add_change_and_remove_medications(self):
        plan_id = self.consult_with([self.medication('Amoxicilina')]).data['treatment']['id']
        url = f'/api/treatment-plans/{plan_id}/'
        self.assertEqual([item['medication_name'] for item in self.client.get(url).data['medications']], ['Amoxicilina'])
        # Añadir un segundo medicamento.
        response = self.client.patch(url, {'medications': [self.medication('Amoxicilina'), self.medication('Ibuprofeno')]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([item['medication_name'] for item in response.data['medications']], ['Amoxicilina', 'Ibuprofeno'])
        change = TreatmentChange.objects.filter(treatment_plan_id=plan_id).latest('created_at')
        self.assertEqual(change.summary, 'Medicación: Amoxicilina 500 mg → Amoxicilina 500 mg, Ibuprofeno 500 mg')
        # La misma receta otra vez no registra nada.
        self.client.patch(url, {'medications': [self.medication('Amoxicilina'), self.medication('Ibuprofeno')]}, format='json')
        self.assertEqual(TreatmentChange.objects.filter(treatment_plan_id=plan_id, summary__startswith='Medicación').count(), 1)
        # Quitar el principal: el siguiente pasa a ser el del plan.
        self.client.patch(url, {'medications': [self.medication('Ibuprofeno')]}, format='json')
        plan = TreatmentPlan.objects.get(pk=plan_id)
        self.assertEqual((plan.medication_name, plan.title), ('Ibuprofeno', 'Ibuprofeno'))
        self.assertEqual(list(plan.prescriptions.filter(is_active=True).values_list('medication_name', flat=True)), ['Ibuprofeno'])
        # Sin medicación.
        self.client.patch(url, {'medications': []}, format='json')
        self.assertFalse(Prescription.objects.filter(treatment_plan_id=plan_id, is_active=True).exists())

    def test_editing_medications_validates_each_one(self):
        plan_id = self.consult_with([self.medication('Amoxicilina')]).data['treatment']['id']
        response = self.client.patch(f'/api/treatment-plans/{plan_id}/', {
            'medications': [self.medication('Amoxicilina'), {**self.medication('Ibuprofeno'), 'strength': ''}],
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['medications'][0], {})
        self.assertIn('strength', response.data['medications'][1])
        self.assertEqual(Prescription.objects.filter(treatment_plan_id=plan_id, is_active=True).count(), 1)

    def test_a_control_replaces_the_whole_prescription(self):
        plan_id = self.consult_with([self.medication('Amoxicilina'), self.medication('Ibuprofeno')]).data['treatment']['id']
        response = self.client.post(f'/api/treatment-plans/{plan_id}/controls/', {
            'prescribes_medication': True, 'medications': [self.medication('Paracetamol'), self.medication('Clorhexidina')],
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        active = Prescription.objects.filter(treatment_plan_id=plan_id, is_active=True)
        self.assertEqual(sorted(active.values_list('medication_name', flat=True)), ['Clorhexidina', 'Paracetamol'])
        self.assertEqual(Prescription.objects.filter(treatment_plan_id=plan_id, is_active=False).count(), 2)
        self.assertEqual(TreatmentPlan.objects.get(pk=plan_id).medication_name, 'Paracetamol')

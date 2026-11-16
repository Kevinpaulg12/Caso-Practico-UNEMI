"""Consulta según el tratamiento, controles sin agenda, avance de fases, checklist de cuidados y protocolos."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User, UserProfile

from .models import CareCheckin, ClinicalProcedure, ControlVisit, Prescription, TreatmentChange, TreatmentPlan
from .tests_support import sample_clinical_data


class FollowUpFixture(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('laura', password='x', role=User.Roles.DOCTOR)
        cls.other_doctor = User.objects.create_user('otro', password='x', role=User.Roles.DOCTOR)
        cls.admin = User.objects.create_user('admin', password='x', role=User.Roles.ADMIN)
        cls.patient = User.objects.create_user('p', password='x', role=User.Roles.PATIENT, first_name='Ana')
        UserProfile.objects.create(user=cls.patient, primary_doctor=cls.doctor)
        cls.ortho = ClinicalProcedure.objects.get(code='ORT-001')

    def login(self, user):
        self.client.force_authenticate(user=user)

    def consult(self, **extra):
        self.login(self.doctor)
        payload = {
            'patient': self.patient.pk, 'medication_name': 'Ibuprofeno', 'active_ingredient': 'Ibuprofeno',
            'strength': '400 mg', 'dosage_form': 'Tableta', 'frequency': 'Cada 8 horas', 'duration': '3 días',
            'clinical_procedure': self.ortho.pk, 'admission_reason': 'Apiñamiento dental',
            'details': 'Ibuprofeno 400 mg cada 8 horas si hay dolor tras el ajuste',
            'instructions': 'Cepillado tras cada comida y uso de cera.', **extra,
        }
        payload.setdefault('clinical_data', sample_clinical_data(payload['clinical_procedure']))
        return self.client.post('/api/consultations/', payload, format='json')


class ConsultationFollowUpTests(FollowUpFixture):
    def test_consultation_creates_phases_teeth_and_next_control(self):
        response = self.consult(teeth=[13, 23, 13])
        self.assertEqual(response.status_code, 201, response.data)
        treatment = response.data['treatment']
        self.assertEqual(treatment['teeth'], [13, 23])
        self.assertEqual(treatment['specialty'], 'ortodoncia')
        self.assertEqual([phase['name'] for phase in treatment['phases']],
                         ['Alineación y nivelación', 'Corrección de la mordida', 'Finalización', 'Retención'])
        self.assertEqual(treatment['current_phase']['status'], 'active')
        # Sin indicación del odontólogo, el próximo control sale del protocolo (brackets: cada 28 días).
        self.assertEqual(self.ortho.control_every_days, 28)
        self.assertEqual(treatment['next_control'], {
            'date': timezone.localdate() + timedelta(days=28), 'days_left': 28, 'overdue': False,
        })

    def test_dentist_can_adjust_or_skip_the_next_control(self):
        adjusted = self.consult(next_control_in_days=8).data['treatment']
        self.assertEqual(adjusted['next_control']['days_left'], 8)
        self.assertIsNone(self.consult(next_control_in_days=0).data['treatment']['next_control'])
        for invalid in (-1, 731, 'pronto', 2.5):
            with self.subTest(invalid=invalid):
                response = self.consult(next_control_in_days=invalid)
                self.assertEqual(response.status_code, 400)
                self.assertIn('next_control_in_days', response.data)

    def test_invalid_teeth_are_rejected(self):
        response = self.consult(teeth=[19, 99])
        self.assertEqual(response.status_code, 400)
        self.assertIn('19', response.data['teeth'])
        self.assertFalse(TreatmentPlan.objects.exists())


class ProtocolFormTests(FollowUpFixture):
    """Cada tratamiento tiene sus propios datos y la receta es opcional."""

    def test_consultation_without_medication_creates_no_prescription(self):
        response = self.consult(
            prescribes_medication=False, medication_name='', active_ingredient='', strength='', dosage_form='',
            frequency='', duration='', details='',
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(response.data['prescription'])
        self.assertFalse(Prescription.objects.exists())
        plan = TreatmentPlan.objects.get()
        self.assertEqual((plan.title, plan.treatment_type, plan.medication_name), ('Ortodoncia con brackets', 'therapy', ''))
        self.assertEqual(plan.instructions, 'Cepillado tras cada comida y uso de cera.')
        # El checklist del paciente no inventa una toma de medicación.
        self.login(self.patient)
        self.assertFalse(any(item.startswith('Tomar') for item in self.client.get('/api/care-checkins/').data['items']))

    def test_medication_is_validated_only_when_prescribed(self):
        response = self.consult(medication_name='', strength='')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.data), {'medication_name', 'strength'})

    def test_instructions_are_always_required(self):
        response = self.consult(prescribes_medication=False, details='', instructions='corto')
        self.assertEqual(response.status_code, 400)
        self.assertIn('details', response.data)

    def test_protocol_fields_are_saved_with_their_labels(self):
        response = self.consult(clinical_data={'aparato': 'Brackets estéticos', 'arcadas': 'Ambas', 'arco': 'ignorado'})
        self.assertEqual(response.status_code, 201, response.data)
        treatment = response.data['treatment']
        # «arco» es un dato del control, no del inicio: no se guarda aquí.
        self.assertEqual(treatment['clinical_data'], {'aparato': 'Brackets estéticos', 'arcadas': 'Ambas'})
        self.assertEqual(treatment['clinical_data_display'], [
            {'label': 'Tipo de aparato', 'value': 'Brackets estéticos'},
            {'label': 'Arcadas tratadas', 'value': 'Ambas'},
        ])

    def test_protocol_fields_are_validated(self):
        cases = (
            ({'arcadas': 'Ambas'}, 'aparato', 'Completa'),
            ({'aparato': 'Brackets de madera', 'arcadas': 'Ambas'}, 'aparato', 'opciones'),
            ('texto', 'detail', 'formato'),
        )
        for clinical_data, key, message in cases:
            with self.subTest(clinical_data=clinical_data):
                response = self.consult(clinical_data=clinical_data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(message, response.data['clinical_data'][key])
        self.assertFalse(TreatmentPlan.objects.exists())

    def test_number_boolean_and_text_fields(self):
        endodontics = ClinicalProcedure.objects.get(code='COD-END-001')
        base = {'diagnostico_pulpar': 'Necrosis pulpar', 'obturacion': 'Provisional'}
        for conductos in (0, 7, 'dos', True):
            with self.subTest(conductos=conductos):
                response = self.consult(clinical_procedure=endodontics.pk, clinical_data={**base, 'conductos': conductos})
                self.assertIn('entre 1 y 6', response.data['clinical_data']['conductos'])
        ok = self.consult(clinical_procedure=endodontics.pk, clinical_data={**base, 'conductos': '3'})
        self.assertEqual(ok.data['treatment']['clinical_data']['conductos'], 3)
        implant = ClinicalProcedure.objects.get(code='COD-MAX-008')
        response = self.consult(clinical_procedure=implant.pk, clinical_data={'implante': 'x' * 201, 'injerto': 'sí'})
        self.assertEqual(set(response.data['clinical_data']), {'implante', 'injerto'})

    def test_catalog_describes_each_treatment_form(self):
        self.login(self.doctor)
        items = {item['code']: item for item in self.client.get('/api/procedures/', {'page_size': 100}).data['results']}
        brackets, extraction = items['ORT-001'], items['COD-MAX-014']
        self.assertEqual((brackets['medication_default'], brackets['uses_teeth'], brackets['control_every_days']), (False, False, 28))
        self.assertEqual((extraction['medication_default'], extraction['uses_teeth']), (True, True))
        self.assertIn('anestesia', [field['key'] for field in extraction['consultation_fields']])
        # Todos los protocolos del catálogo traen su formulario.
        self.assertTrue(all(item['consultation_fields'] for item in items.values()))


class PhaseTests(FollowUpFixture):
    def test_advance_phase_until_the_last_one(self):
        plan_id = self.consult().data['treatment']['id']
        url = f'/api/treatment-plans/{plan_id}/advance-phase/'
        response = self.client.post(url)
        self.assertEqual(response.data['current_phase']['name'], 'Corrección de la mordida')
        self.assertEqual(response.data['phases'][0]['status'], 'done')
        plan = TreatmentPlan.objects.get(pk=plan_id)
        self.assertEqual(plan.last_intervention_date, timezone.localdate())
        self.assertTrue(TreatmentChange.objects.filter(summary__contains='Inicia: Corrección').exists())
        self.client.post(url)
        self.client.post(url)
        self.assertEqual(self.client.post(url).status_code, 400)
        self.login(self.patient)
        self.assertEqual(self.client.post(url).status_code, 403)


class ControlTests(FollowUpFixture):
    """El odontólogo no agenda citas: registra el control realizado y el sistema calcula el siguiente."""

    def setUp(self):
        self.plan_id = self.consult().data['treatment']['id']
        self.url = f'/api/treatment-plans/{self.plan_id}/controls/'
        self.valid = {'clinical_data': sample_clinical_data(self.ortho, 'control'), 'notes': 'Cambio de arco.'}

    def control(self, user=None, **extra):
        self.login(user or self.doctor)
        return self.client.post(self.url, {**self.valid, **extra}, format='json')

    def test_control_restarts_the_follow_up_and_sets_the_next_one(self):
        today = timezone.localdate()
        TreatmentPlan.objects.filter(pk=self.plan_id).update(
            start_date=today - timedelta(days=40), last_intervention_date=today - timedelta(days=40),
            next_control_date=today - timedelta(days=12),
        )
        response = self.control()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['control']['next_control_in_days'], 28)
        self.assertEqual(response.data['control']['clinical_data'], [{'label': 'Higiene oral', 'value': 'Buena'}])
        treatment = response.data['treatment']
        self.assertEqual(treatment['postoperative_day'], 0)
        self.assertEqual(treatment['next_control'], {'date': today + timedelta(days=28), 'days_left': 28, 'overdue': False})
        # Un control de ortodoncia no emite una receta nueva.
        self.assertEqual(Prescription.objects.count(), 1)

    def test_dentist_adjusts_when_the_patient_must_return(self):
        self.assertEqual(self.control(next_control_in_days=10).data['treatment']['next_control']['days_left'], 10)
        self.assertIsNone(self.control(next_control_in_days=0).data['treatment']['next_control'])

    def test_a_past_control_counts_from_its_date(self):
        today = timezone.localdate()
        TreatmentPlan.objects.filter(pk=self.plan_id).update(
            start_date=today - timedelta(days=40), last_intervention_date=today - timedelta(days=40),
        )
        response = self.control(date=(today - timedelta(days=30)).isoformat())
        self.assertEqual(response.data['treatment']['postoperative_day'], 30)
        self.assertEqual(response.data['treatment']['next_control'], {
            'date': today - timedelta(days=2), 'days_left': -2, 'overdue': True,
        })

    def test_validation(self):
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        before_start = (timezone.localdate() - timedelta(days=3)).isoformat()
        cases = (
            ({'date': tomorrow}, 'date'), ({'date': before_start}, 'date'), ({'date': 'ayer'}, 'date'),
            ({'notes': 'x' * 1001}, 'notes'), ({'clinical_data': {}}, 'clinical_data'),
            ({'next_control_in_days': 900}, 'next_control_in_days'), ({'instructions': 'corto'}, 'instructions'),
            ({'prescribes_medication': True}, 'medication_name'),
        )
        for data, field in cases:
            with self.subTest(data=data):
                response = self.control(**data)
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)
        self.assertFalse(ControlVisit.objects.exists())

    def test_control_can_change_medication_and_instructions(self):
        response = self.control(
            prescribes_medication=True, medication_name='Paracetamol', active_ingredient='Paracetamol',
            strength='500 mg', dosage_form='Tableta', frequency='Cada 6 horas', duration='2 días',
            instructions='Usa cera sobre el bracket que roza y enjuaga con agua tibia y sal.',
        )
        self.assertEqual(response.status_code, 201, response.data)
        plan = TreatmentPlan.objects.get(pk=self.plan_id)
        self.assertEqual((plan.title, plan.medication_name, plan.schedule_description), ('Paracetamol', 'Paracetamol', 'Cada 6 horas'))
        self.assertTrue(plan.instructions.startswith('Usa cera'))
        active = Prescription.objects.get(is_active=True)
        self.assertEqual((active.medication_name, active.active_ingredient, active.treatment_plan_id), ('Paracetamol', 'Paracetamol', plan.pk))
        self.assertEqual(Prescription.objects.filter(is_active=False).count(), 1)

    def test_only_the_treating_dentist_registers_controls(self):
        self.assertEqual(self.control(user=self.patient).status_code, 403)
        self.assertEqual(self.control(user=self.other_doctor).status_code, 404)
        self.assertEqual(self.control(user=self.admin).status_code, 403)
        TreatmentPlan.objects.filter(pk=self.plan_id).update(is_active=False)
        self.assertEqual(self.control().status_code, 400)

    def test_control_appears_in_the_treatment_history(self):
        self.control()
        events = self.client.get(f'/api/treatment-plans/{self.plan_id}/history/').data['events']
        control = next(event for event in events if event['type'] == 'control')
        self.assertEqual((control['title'], control['notes'], control['next_control_in_days']), ('Control realizado', 'Cambio de arco.', 28))
        start = next(event for event in events if event['type'] == 'start')
        self.assertEqual(start['clinical_data'][0]['label'], 'Tipo de aparato')

    def test_scheduling_endpoints_no_longer_exist(self):
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/appointments/').status_code, 404)
        self.assertEqual(self.client.post('/api/appointments/', {}, format='json').status_code, 404)


class CareCheckinTests(FollowUpFixture):
    def setUp(self):
        self.plan_id = self.consult().data['treatment']['id']

    def test_patient_checklist_comes_from_the_protocol(self):
        self.login(self.patient)
        data = self.client.get('/api/care-checkins/').data
        self.assertIn('Usar los elásticos indicados', data['items'])
        self.assertTrue(any(item.startswith('Tomar Ibuprofeno') for item in data['items']))
        self.assertIsNone(data['today'])

    def test_patient_marks_the_day_and_doctor_sees_adherence(self):
        self.login(self.patient)
        items = self.client.get('/api/care-checkins/').data['items']
        marks = {item: index % 2 == 0 for index, item in enumerate(items)}
        response = self.client.post('/api/care-checkins/', {'items': {**marks, 'Inventado': True}}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('Inventado', response.data['items'])
        # Volver a marcar el mismo día actualiza el registro.
        self.assertEqual(self.client.post('/api/care-checkins/', {'items': {items[0]: True}}, format='json').status_code, 200)
        self.assertEqual(CareCheckin.objects.count(), 1)
        self.login(self.doctor)
        data = self.client.get('/api/care-checkins/', {'plan': self.plan_id}).data
        self.assertEqual(data['adherence_7_days'], 100)
        self.login(self.other_doctor)
        self.assertEqual(self.client.get('/api/care-checkins/', {'plan': self.plan_id}).status_code, 404)

    def test_invalid_checkins(self):
        self.login(self.patient)
        for items in ({}, {'Cepillado': 'sí'}, ['a']):
            with self.subTest(items=items):
                self.assertEqual(self.client.post('/api/care-checkins/', {'items': items}, format='json').status_code, 400)


class ProtocolAdminTests(FollowUpFixture):
    def test_admin_edits_a_protocol_with_validation(self):
        self.login(self.admin)
        url = f'/api/procedures/{self.ortho.pk}/'
        ok = self.client.patch(url, {
            'expected_symptoms': {'Llaga o úlcera': 10}, 'care_items': ['Usar cera'],
            'follow_up_questions': {'*': ['¿Usaste los elásticos?']},
            'default_phases': [{'name': 'Alineación', 'days': 120}],
        }, format='json')
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data['specialty_label'], 'Ortodoncia')
        for data in ({'expected_symptoms': {'Dolor de alma': 2}}, {'alarm_symptoms': ['Inventado']},
                     {'default_phases': [{'name': '', 'days': 3}]}, {'care_items': 'cepillarse'},
                     {'follow_up_questions': {'Dolor': ['x' * 201]}}):
            with self.subTest(data=data):
                self.assertEqual(self.client.patch(url, data, format='json').status_code, 400)


class DashboardListTests(FollowUpFixture):
    def test_list_shows_specialty_treatment_and_next_control(self):
        self.consult(next_control_in_days=3)
        self.login(self.doctor)
        item = self.client.get('/api/patients/').data[0]
        self.assertEqual((item['specialty'], item['specialty_label']), ('ortodoncia', 'Ortodoncia'))
        self.assertEqual(item['treatment'], 'Ortodoncia con brackets')
        self.assertEqual(item['next_control'], {
            'date': timezone.localdate() + timedelta(days=3), 'days_left': 3, 'overdue': False,
        })
        # Otro odontólogo localiza la ficha por cédula, pero no ve el estado clínico.
        UserProfile.objects.filter(user=self.patient).update(national_id='1712345678')
        self.login(self.other_doctor)
        self.assertIsNone(self.client.get('/api/patients/', {'search': '1712345678'}).data[0]['next_control'])


class ReminderTests(FollowUpFixture):
    def setUp(self):
        self.patient.email = 'ana@example.com'
        self.patient.save()
        self.plan = TreatmentPlan.objects.get(pk=self.consult().data['treatment']['id'])
        self.today = timezone.localdate()

    def at(self, hour):
        return timezone.make_aware(timezone.datetime.combine(timezone.localdate(), timezone.datetime.min.time())
                                   .replace(hour=hour))

    def control_in(self, days):
        self.plan.next_control_date = self.today + timedelta(days=days) if days is not None else None
        self.plan.save(update_fields=['next_control_date'])

    def control_reminder(self):
        from .reminders import pending_for_plan
        return next((item for item in pending_for_plan(self.plan, now=self.at(11)) if item['kind'] == 'control'), None)

    def test_control_reminder_stages(self):
        for days in (None, 28, 4):
            with self.subTest(days=days):
                self.control_in(days)
                self.assertIsNone(self.control_reminder())
        stages = ((3, 'soon', 'toca el'), (1, 'soon', 'toca el'), (0, 'today', 'Hoy te toca'),
                  (-1, 'late0', 'debía ser'), (-6, 'late0', 'debía ser'), (-7, 'late1', 'debía ser'), (-15, 'late2', 'debía ser'))
        for days, stage, phrase in stages:
            with self.subTest(days=days):
                self.control_in(days)
                reminder = self.control_reminder()
                self.assertEqual(reminder['key'], f'control:{self.plan.pk}:{self.plan.next_control_date.isoformat()}:{stage}')
                self.assertIn(phrase, reminder['text'])
                self.assertIn('ortodoncia con brackets', reminder['text'])
                self.assertIn('consultorio', reminder['text'])

    def test_reminder_names_the_day_in_spanish(self):
        self.control_in(2)
        due = self.plan.next_control_date
        months = ('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
                  'octubre', 'noviembre', 'diciembre')
        self.assertIn(f'{due.day} de {months[due.month - 1]}', self.control_reminder()['text'])

    def test_pending_reminders(self):
        from .reminders import pending_for_plan
        # Ortodoncia: se espera un reporte por semana; el último fue hace 8 días.
        TreatmentPlan.objects.filter(pk=self.plan.pk).update(
            start_date=self.today - timedelta(days=8), last_intervention_date=self.today - timedelta(days=8),
            next_control_date=self.today + timedelta(days=1),
        )
        self.plan.refresh_from_db()
        kinds = {item['kind'] for item in pending_for_plan(self.plan, now=self.at(19))}
        self.assertEqual(kinds, {'control', 'report', 'care'})
        self.assertEqual({item['kind'] for item in pending_for_plan(self.plan, now=self.at(11))}, {'control', 'report'})

    def test_send_reminders_once_by_email(self):
        from django.core import mail
        from django.core.management import call_command
        self.control_in(2)
        call_command('send_reminders', stdout=open('/dev/null', 'w'))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('Tu control de ortodoncia con brackets toca el', mail.outbox[0].body)
        call_command('send_reminders', stdout=open('/dev/null', 'w'))
        self.assertEqual(len(mail.outbox), 1)
        # El día del control se envía un aviso distinto, también una sola vez.
        self.control_in(0)
        call_command('send_reminders', stdout=open('/dev/null', 'w'))
        call_command('send_reminders', stdout=open('/dev/null', 'w'))
        self.assertEqual(len(mail.outbox), 2)

    def test_patient_sees_reminders_in_the_portal(self):
        self.control_in(1)
        self.login(self.patient)
        reminders = self.client.get('/api/reminders/').data
        self.assertEqual(reminders[0]['kind'], 'control')
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/reminders/').status_code, 403)

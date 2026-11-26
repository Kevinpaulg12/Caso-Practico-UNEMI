"""Agenda en línea del odontólogo: horario, bloqueos y reservas por orden de llegada desde el chat."""
from datetime import date, datetime, time, timedelta

from django.core import mail
from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User, UserProfile

from . import appointments
from .ai import assistant
from .models import (
    AppointmentRequest,
    ClinicalProcedure,
    DoctorSchedule,
    PatientReport,
    TimeOff,
    TreatmentPlan,
    WorkingHours,
)

TOMORROW = timezone.localdate() + timedelta(days=1)


def at(day, hour, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


class AgendaFixture(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('laura', password='x', role=User.Roles.DOCTOR, first_name='Laura',
                                              last_name='Mora', email='laura@clinica.ec')
        cls.other_doctor = User.objects.create_user('pedro', password='x', role=User.Roles.DOCTOR)
        cls.patient = User.objects.create_user('juan', password='x', role=User.Roles.PATIENT, first_name='Juan',
                                               email='juan@example.com')
        cls.other_patient = User.objects.create_user('ana', password='x', role=User.Roles.PATIENT, first_name='Ana')
        for patient in (cls.patient, cls.other_patient):
            UserProfile.objects.create(user=patient, primary_doctor=cls.doctor)
        cls.plan = TreatmentPlan.objects.create(
            patient=cls.patient, title='Brackets', treatment_type='therapy', schedule_description='Controles',
            instructions='Cepíllate después de cada comida.', procedure='Ortodoncia con brackets',
            clinical_procedure=ClinicalProcedure.objects.get(code='ORT-001'),
            start_date=timezone.localdate() - timedelta(days=20),
        )
        # Ana ya terminó un tratamiento: puede volver a pedir cita (para valorar uno nuevo).
        TreatmentPlan.objects.create(
            patient=cls.other_patient, title='Exodoncia', treatment_type='therapy', schedule_description='x',
            instructions='Dieta blanda.', procedure='Exodoncia simple', is_active=False,
            start_date=timezone.localdate() - timedelta(days=90),
        )
        # Atiende todos los días de 08:00 a 10:00, en turnos de 30 minutos.
        DoctorSchedule.objects.create(doctor=cls.doctor, slot_minutes=30, max_days_ahead=14)
        WorkingHours.objects.bulk_create([
            WorkingHours(doctor=cls.doctor, weekday=day, start=time(8), end=time(10)) for day in range(7)
        ])

    def login(self, user):
        self.client.force_authenticate(user=user)

    def say(self, text='', user=None, **extra):
        self.login(user or self.patient)
        response = self.client.post('/api/assistant/messages/', {'text': text, **extra}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['message']


class FreeSlotsTests(AgendaFixture):
    def hours(self, day):
        return [f'{timezone.localtime(slot):%H:%M}' for slot in appointments.free_slots(self.doctor, day)]

    def test_slots_follow_the_schedule_and_skip_what_is_taken_or_blocked(self):
        self.assertEqual(self.hours(TOMORROW), ['08:00', '08:30', '09:00', '09:30'])
        appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 8, 30))
        TimeOff.objects.create(doctor=self.doctor, date=TOMORROW, start=time(9, 15), end=time(9, 45))
        self.assertEqual(self.hours(TOMORROW), ['08:00'])
        # Un día bloqueado entero, uno fuera del alcance y otro sin horario no tienen turnos.
        TimeOff.objects.create(doctor=self.doctor, date=TOMORROW + timedelta(days=1))
        self.assertEqual(self.hours(TOMORROW + timedelta(days=1)), [])
        self.assertEqual(self.hours(TOMORROW + timedelta(days=30)), [])
        self.assertEqual(appointments.free_slots(self.other_doctor, TOMORROW), [])

    def test_past_hours_of_today_are_not_offered(self):
        today = timezone.localdate()
        noon = at(today, 9, 10)
        slots = appointments.free_slots(self.doctor, today, now=noon)
        self.assertEqual([f'{timezone.localtime(slot):%H:%M}' for slot in slots], ['09:30'])

    def test_first_come_first_served(self):
        appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 8))
        with self.assertRaises(appointments.SlotTaken):
            appointments.book(self.other_patient, None, self.doctor, at(TOMORROW, 8))
        # Una hora que no es el inicio de un turno tampoco se puede reservar.
        with self.assertRaises(appointments.SlotTaken):
            appointments.book(self.other_patient, None, self.doctor, at(TOMORROW, 8, 10))
        self.assertEqual(AppointmentRequest.objects.count(), 1)

    def test_booking_sets_the_kind_and_the_next_control(self):
        with self.captureOnCommitCallbacks(execute=True):
            followup = appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 9), 'Bracket suelto')
            assessment = appointments.book(self.other_patient, None, self.doctor, at(TOMORROW, 9, 30))
        self.assertEqual((followup.kind, assessment.kind), ('followup', 'assessment'))
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.next_control_date, TOMORROW)
        recipients = [message.to for message in mail.outbox]
        self.assertIn(['juan@example.com'], recipients)
        self.assertIn(['laura@clinica.ec'], recipients)
        self.assertIn('Bracket suelto', next(m for m in mail.outbox if m.to == ['laura@clinica.ec']).body)


class ChatBookingTests(AgendaFixture):
    def test_the_patient_books_a_free_slot_in_the_conversation(self):
        first = self.say('Quiero una cita porque se me rompió el bracket')
        self.assertIn('¿Qué día te queda bien?', first['text'])
        self.assertEqual(first['input'], 'date')
        self.assertEqual(len(first['choices']), 5)
        hours = self.say(first['choices'][0])
        self.assertIn('¿A qué hora?', hours['text'])
        self.assertIn('08:30', hours['choices'])
        with self.captureOnCommitCallbacks(execute=True):
            done = self.say('08:30')
        self.assertIn('quedó reservada', done['text'])
        booking = AppointmentRequest.objects.get()
        self.assertEqual((booking.status, booking.doctor, booking.kind, booking.treatment_plan),
                         ('booked', self.doctor, 'followup', self.plan))
        self.assertEqual(f'{timezone.localtime(booking.starts_at):%H:%M}', '08:30')
        self.assertIn('se me rompió el bracket', booking.reason)
        self.assertTrue(mail.outbox)
        # Las respuestas de día y hora no se analizan como síntomas.
        self.assertNotIn('08:30', PatientReport.objects.get().message)

    def test_a_taken_hour_is_no_longer_offered_to_the_next_patient(self):
        appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 8))
        self.say('Necesito una cita', user=self.other_patient)
        hours = self.say('', user=self.other_patient, appointment_date=TOMORROW.isoformat())
        self.assertNotIn('08:00', hours['choices'])
        # Si otro paciente toma la hora mientras elige, se le ofrecen las que quedan.
        appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 8, 30))
        reply = self.say('08:30', user=self.other_patient)
        self.assertIn('Esa hora no está libre', reply['text'])
        self.assertEqual(reply['choices'], ['09:00', '09:30'])

    def test_a_full_day_offers_the_next_one(self):
        TimeOff.objects.create(doctor=self.doctor, date=TOMORROW)
        self.say('quiero agendar una revisión')
        reply = self.say('', appointment_date=TOMORROW.isoformat())
        self.assertIn('Ese día ya no hay turnos libres', reply['text'])
        self.assertNotIn(appointments.long_day(TOMORROW), reply['text'])

    def test_change_or_cancel_an_existing_appointment(self):
        old = appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 8))
        manage = self.say('quiero una cita')
        self.assertEqual(manage['choices'], assistant.MANAGE_CHOICES)
        days = self.say('Cambiar mi cita')
        self.say('', appointment_date=(TOMORROW + timedelta(days=1)).isoformat())
        self.assertIn('quedó reservada', self.say('9:00')['text'])
        old.refresh_from_db()
        self.assertEqual(old.status, 'cancelled')
        self.assertTrue(days['choices'])
        new = AppointmentRequest.objects.get(status='booked')
        self.say('quiero una cita')
        self.assertIn('cancelé tu cita', self.say('Cancelar mi cita')['text'])
        new.refresh_from_db()
        self.assertEqual(new.status, 'cancelled')

    def test_without_a_published_schedule_the_clinic_phone_is_given(self):
        UserProfile.objects.filter(user=self.patient).update(primary_doctor=self.other_doctor)
        self.patient.profile.refresh_from_db()
        reply = self.say('quiero una cita')
        self.assertIn('no tiene su agenda en línea', reply['text'])
        self.assertIn('04 270 0000', reply['text'])
        self.assertFalse(AppointmentRequest.objects.exists())

    def test_after_discharge_the_appointment_is_an_assessment(self):
        TreatmentPlan.objects.filter(pk=self.plan.pk).update(is_active=False)
        self.assertIn('tu odontólogo te dio de alta', self.say('Me duele un poco la encía')['text'])
        self.say('Quiero una cita de revisión')
        self.say('', appointment_date=TOMORROW.isoformat())
        self.say('8:00')
        booking = AppointmentRequest.objects.get()
        self.assertEqual((booking.kind, booking.status), ('assessment', 'booked'))
        self.assertFalse(PatientReport.objects.exists())

    def test_cancel_the_flow_and_parse_dates_and_hours(self):
        self.say('quisiera agendar una revisión')
        self.assertIn('No entendí la fecha', self.say('cuando puedan')['text'])
        self.assertIn('14 días', self.say('', appointment_date='2020-01-01')['text'])
        self.assertIn('no reservaré', self.say('mejor no, cancela')['text'])
        self.assertFalse(AppointmentRequest.objects.exists())
        today = date(2026, 11, 17)  # martes
        for text, expected in {'pasado mañana': date(2026, 11, 19), 'el viernes': date(2026, 11, 20),
                               '25/11': date(2026, 11, 25), 'cuando sea': None}.items():
            self.assertEqual(assistant.parse_preferred_date(text, today), expected)
        for text, expected in {'08:30': (8, 30), '3 pm': (15, 0), '9h00': (9, 0), 'a las 4 de la tarde': (16, 0)}.items():
            self.assertEqual(assistant.parse_time(text), expected)


class ScheduleApiTests(AgendaFixture):
    def test_the_dentist_publishes_his_schedule(self):
        self.login(self.other_doctor)
        self.assertFalse(self.client.get('/api/doctor/schedule/').data['published'])
        payload = {'slot_minutes': 45, 'max_days_ahead': 20, 'hours': [
            {'weekday': 0, 'start': '08:00', 'end': '12:00'}, {'weekday': 0, 'start': '14:00', 'end': '18:00'},
        ]}
        response = self.client.put('/api/doctor/schedule/', payload, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['published'])
        self.assertEqual(len(response.data['hours']), 2)
        for broken in (
            {**payload, 'slot_minutes': 25},
            {**payload, 'hours': [{'weekday': 0, 'start': '08:00', 'end': '12:00'}, {'weekday': 0, 'start': '11:00', 'end': '13:00'}]},
            {**payload, 'hours': [{'weekday': 9, 'start': '08:00', 'end': '12:00'}]},
            {**payload, 'hours': [{'weekday': 1, 'start': '12:00', 'end': '08:00'}]},
        ):
            with self.subTest(broken=broken):
                self.assertEqual(self.client.put('/api/doctor/schedule/', broken, format='json').status_code, 400)
        self.login(self.patient)
        self.assertEqual(self.client.get('/api/doctor/schedule/').status_code, 403)

    def test_blocking_a_day_cancels_its_appointments_and_warns_the_patients(self):
        appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 8))
        appointments.book(self.other_patient, None, self.doctor, at(TOMORROW, 9, 30))
        self.login(self.doctor)
        preview = self.client.get('/api/doctor/time-off/preview/', {'date': TOMORROW.isoformat(), 'start': '07:00', 'end': '09:00'})
        self.assertEqual([item['patient_name'] for item in preview.data['appointments']], ['Juan'])
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/doctor/time-off/', {'date': TOMORROW.isoformat(), 'reason': 'Congreso'}, format='json')
        self.assertEqual((response.status_code, response.data['cancelled_appointments']), (201, 2))
        self.assertFalse(AppointmentRequest.objects.filter(status='booked').exists())
        juan = next(message for message in mail.outbox if message.to == ['juan@example.com'])
        self.assertIn('Congreso', juan.body)
        self.assertEqual(appointments.free_slots(self.doctor, TOMORROW), [])
        self.assertEqual(len(self.client.get('/api/doctor/time-off/').data), 1)
        self.assertEqual(self.client.post('/api/doctor/time-off/', {'date': '2020-01-01'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/doctor/time-off/', {'date': TOMORROW.isoformat(), 'start': '09:00'}, format='json').status_code, 400)

    def test_the_agenda_lists_the_booked_appointments_with_their_kind(self):
        appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 8))
        appointments.book(self.other_patient, None, self.doctor, at(TOMORROW, 9))
        self.login(self.doctor)
        data = self.client.get('/api/doctor/agenda/').data
        self.assertEqual([(item['patient_name'], item['kind_label']) for item in data['appointments']],
                         [('Juan', 'Seguimiento'), ('Ana', 'Valoración de un tratamiento nuevo')])
        self.assertEqual(data['free_slots_per_day'][TOMORROW.isoformat()], 2)
        self.assertEqual(self.client.get('/api/doctor/agenda/', {'from': 'ayer'}).status_code, 400)


class CancelApiTests(AgendaFixture):
    def setUp(self):
        self.booking = appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 8))
        self.url = f'/api/appointment-requests/{self.booking.pk}/cancel/'

    def test_the_patient_cancels_and_the_slot_is_free_again(self):
        self.login(self.other_patient)
        self.assertEqual(self.client.post(self.url).status_code, 404)
        self.login(self.patient)
        upcoming = self.client.get('/api/appointment-requests/', {'upcoming': 'true', 'status': 'booked'}).data['results']
        self.assertEqual(upcoming[0]['doctor_name'], 'Laura Mora')
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post(self.url).data['status'], 'cancelled')
        self.assertIn('canceló su cita', mail.outbox[-1].body)
        self.assertIn(at(TOMORROW, 8), appointments.free_slots(self.doctor, TOMORROW))
        self.assertEqual(self.client.post(self.url).status_code, 400)

    def test_the_dentist_cancels_with_a_reason(self):
        self.login(self.doctor)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url, {'reason': 'Emergencia en quirófano'}, format='json')
        self.assertEqual(response.data['note'], 'Emergencia en quirófano')
        self.assertIn('Emergencia en quirófano', mail.outbox[-1].body)
        self.assertEqual(mail.outbox[-1].to, ['juan@example.com'])

    def test_a_control_that_day_marks_the_appointment_as_attended(self):
        appointments.mark_attended(self.patient, TOMORROW)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'attended')


class DailyAgendaEmailTests(AgendaFixture):
    def test_each_dentist_receives_his_day_once_from_six_thirty(self):
        from .daily_agenda import send_daily_agendas
        today = timezone.localdate()
        # Citas de hoy creadas directamente (a esta hora del día los turnos ya podrían haber pasado).
        for patient, plan, hour, kind in ((self.patient, self.plan, 9, 'followup'), (self.other_patient, None, 8, 'assessment')):
            AppointmentRequest.objects.create(
                patient=patient, doctor=self.doctor, treatment_plan=plan, starts_at=at(today, hour), kind=kind,
                preferred_date=today, preferred_period='morning', reason='Se despegó un bracket' if plan else '',
            )
        self.assertEqual(send_daily_agendas(now=at(today, 6, 0)), 0)
        self.assertEqual(send_daily_agendas(now=at(today, 6, 45)), 1)
        self.assertEqual(send_daily_agendas(now=at(today, 7, 0)), 0)
        message = mail.outbox[0]
        self.assertEqual(message.to, ['laura@clinica.ec'])
        self.assertIn('Hoy tienes 2 citas: 1 de seguimiento y 1 de valoración', message.body)
        # En orden de hora, con el tipo de cita y el motivo que escribió el paciente.
        self.assertLess(message.body.index('08:00 · Ana · Valoración'), message.body.index('09:00 · Juan · Seguimiento de ortodoncia'))
        self.assertIn('Se despegó un bracket', message.body)


class ChooseDoctorAfterDischargeTests(AgendaFixture):
    """Tras el alta, el paciente elige con qué odontólogo reservar; ese odontólogo puede ver su historia."""

    def setUp(self):
        self.other_doctor.first_name, self.other_doctor.last_name = 'Pedro', 'Vera'
        self.other_doctor.save()
        DoctorSchedule.objects.create(doctor=self.other_doctor, slot_minutes=30, max_days_ahead=14)
        WorkingHours.objects.bulk_create([
            WorkingHours(doctor=self.other_doctor, weekday=day, start=time(14), end=time(16)) for day in range(7)
        ])

    def test_a_discharged_patient_chooses_another_doctor(self):
        first = self.say('Quiero una cita', user=self.other_patient)
        self.assertIn('¿Con quién quieres la cita?', first['text'])
        # Su odontólogo anterior va primero.
        self.assertEqual(first['choices'], ['Dr(a). Laura Mora (tu odontólogo)', 'Dr(a). Pedro Vera'])
        days = self.say('Pedro', user=self.other_patient)
        self.assertIn('Pedro Vera', days['text'])
        hours = self.say('', user=self.other_patient, appointment_date=TOMORROW.isoformat())
        self.assertEqual(hours['choices'][0], '14:00')
        with self.captureOnCommitCallbacks(execute=True):
            self.say('14:00', user=self.other_patient)
        booking = AppointmentRequest.objects.get()
        self.assertEqual((booking.doctor, booking.kind), (self.other_doctor, 'assessment'))
        # El nuevo odontólogo ya lo ve entre sus pacientes y puede abrir su historia clínica.
        self.login(self.other_doctor)
        self.assertEqual(self.client.get(f'/api/patients/{self.other_patient.pk}/clinical-history/').status_code, 200)
        from users.models import patients_of
        self.assertIn(self.other_patient, patients_of(self.other_doctor))

    def test_with_an_active_treatment_the_appointment_is_with_the_treating_doctor(self):
        first = self.say('Quiero una cita')
        self.assertIn('Laura Mora', first['text'])
        self.assertIn('¿Qué día te queda bien?', first['text'])

    def test_the_new_doctor_becomes_the_treating_doctor_after_the_consultation(self):
        appointments.book(self.other_patient, TreatmentPlan.objects.get(patient=self.other_patient), self.other_doctor, at(TOMORROW, 14))
        self.login(self.other_doctor)
        response = self.client.post('/api/consultations/', {
            'patient': self.other_patient.pk, 'procedure': 'Exodoncia simple', 'admission_reason': 'Dolor en molar inferior',
            'instructions': 'Compresas frías 15 minutos cada hora.', 'prescribes_medication': False,
            'surgery_date': str(timezone.localdate()),
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.other_patient.profile.refresh_from_db()
        self.assertEqual(self.other_patient.profile.primary_doctor, self.other_doctor)
        self.assertEqual(TreatmentPlan.objects.get(pk=response.data['treatment']['id']).doctor, self.other_doctor)


class DoctorNotificationsTests(AgendaFixture):
    URL = '/api/doctor/notifications/'

    def test_lists_upcoming_bookings_and_recent_red_alerts(self):
        appointments.book(self.patient, self.plan, self.doctor, at(TOMORROW, 9))
        appointments.book(self.other_patient, TreatmentPlan.objects.get(patient=self.other_patient), self.doctor, at(TOMORROW, 8))
        PatientReport.objects.create(patient=self.patient, treatment_plan=self.plan, pain_level=9, risk_level='Alto',
                                     message='Me duele muchísimo', alert_reasons=['Dolor EVA 9'])
        PatientReport.objects.create(patient=self.patient, treatment_plan=self.plan, pain_level=2, risk_level='Bajo', message='Bien')
        self.login(self.doctor)
        data = self.client.get(self.URL).data
        self.assertEqual([item['patient_name'] for item in data['appointments']], ['Ana', 'Juan'])
        self.assertEqual(data['appointments'][0]['patient_id'], self.other_patient.pk)
        self.assertEqual([(item['patient_name'], item['reasons']) for item in data['alerts']], [('Juan', ['Dolor EVA 9'])])
        # Otro odontólogo no ve nada de esto; el paciente no puede usarlo.
        self.login(self.other_doctor)
        self.assertEqual(self.client.get(self.URL).data, {'appointments': [], 'alerts': []})
        self.login(self.patient)
        self.assertEqual(self.client.get(self.URL).status_code, 403)

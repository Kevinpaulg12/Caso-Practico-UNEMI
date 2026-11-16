"""La migración que retira la agenda conserva lo que importaba de las citas."""
from datetime import timedelta

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone

APP = 'medical_monitor'
# Se fija también la app de usuarios para que el estado histórico coincida con las tablas reales.
USERS = ('users', '0010_terms_exact_age_version')
BEFORE = [(APP, '0018_controls_and_protocol_forms'), USERS]
AFTER = [(APP, '0020_remove_appointments'), USERS]


class AppointmentsToControlsMigrationTests(TransactionTestCase):
    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        return MigrationExecutor(connection).loader.project_state(target).apps

    def tearDown(self):
        # Deja el esquema al día para las pruebas siguientes.
        MigrationExecutor(connection).migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())

    def test_done_appointments_become_controls_and_the_next_one_becomes_the_next_control(self):
        apps = self.migrate(BEFORE)
        User = apps.get_model('users', 'User')
        Plan = apps.get_model(APP, 'TreatmentPlan')
        Appointment = apps.get_model(APP, 'Appointment')
        Procedure = apps.get_model(APP, 'ClinicalProcedure')
        Reminder = apps.get_model(APP, 'Reminder')
        now, today = timezone.now(), timezone.localdate()
        doctor = User.objects.create(username='doc', role='DOC')
        patient = User.objects.create(username='pac', role='PAT')
        brackets = Procedure.objects.get(code='ORT-001')
        extraction = Procedure.objects.get(code='COD-MAX-001')

        def plan(procedure, days_ago, **extra):
            return Plan.objects.create(
                patient=patient, title='T', treatment_type='therapy', schedule_description='x', instructions='x',
                clinical_procedure=procedure, start_date=today - timedelta(days=days_ago), **extra,
            )

        with_appointments = plan(brackets, 60)
        Appointment.objects.create(treatment_plan=with_appointments, doctor=doctor, kind='adjustment',
                                   status='done', scheduled_at=now - timedelta(days=30), notes='Cambio de arco')
        Appointment.objects.create(treatment_plan=with_appointments, doctor=doctor, status='cancelled',
                                   scheduled_at=now - timedelta(days=10))
        Appointment.objects.create(treatment_plan=with_appointments, doctor=doctor, status='scheduled',
                                   scheduled_at=now + timedelta(days=20))
        upcoming = Appointment.objects.create(treatment_plan=with_appointments, doctor=doctor, status='scheduled',
                                              scheduled_at=now + timedelta(days=9))
        recent = plan(brackets, 5)
        old = plan(extraction, 40)
        closed = plan(brackets, 5, is_active=False)
        Reminder.objects.create(kind='appointment', key=f'appointment:{upcoming.pk}', user=patient)
        Reminder.objects.create(kind='report', key='report:1:2026-11-10', user=patient)

        apps = self.migrate(AFTER)
        Plan = apps.get_model(APP, 'TreatmentPlan')
        ControlVisit = apps.get_model(APP, 'ControlVisit')
        Procedure = apps.get_model(APP, 'ClinicalProcedure')

        visit = ControlVisit.objects.get()
        self.assertEqual((visit.treatment_plan_id, visit.doctor_id, visit.notes), (with_appointments.pk, doctor.pk, 'Ajuste. Cambio de arco'))
        self.assertEqual(visit.date, timezone.localtime(now - timedelta(days=30)).date())

        def next_control(item):
            return Plan.objects.get(pk=item.pk).next_control_date

        # La cita programada más próxima pasa a ser el próximo control.
        self.assertEqual(next_control(with_appointments), timezone.localtime(now + timedelta(days=9)).date())
        # Sin cita, el intervalo del protocolo (brackets: 28 días desde el inicio).
        self.assertEqual(next_control(recent), today + timedelta(days=23))
        # Un tratamiento antiguo no amanece con un control atrasado; uno cerrado no tiene controles.
        self.assertIsNone(next_control(old))
        self.assertIsNone(next_control(closed))
        self.assertEqual(list(apps.get_model(APP, 'Reminder').objects.values_list('kind', flat=True)), ['report'])
        self.assertNotIn('medical_monitor_appointment', connection.introspection.table_names())
        # Los protocolos reciben su intervalo de control y su formulario.
        brackets = Procedure.objects.get(code='ORT-001')
        self.assertEqual((brackets.control_every_days, brackets.medication_default, brackets.uses_teeth), (28, False, False))
        self.assertTrue(brackets.consultation_fields)

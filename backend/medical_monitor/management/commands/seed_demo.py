from datetime import date, timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from medical_monitor.models import (
    CareCheckin,
    ClinicalProcedure,
    ClinicalEvolutionSummary,
    PatientReport,
    Prescription,
    TreatmentPlan,
)
from medical_monitor.services import evaluate_patient_status
from medical_monitor.views import create_phases
from users.models import User, UserProfile


class Command(BaseCommand):
    help = 'Elimina los datos de desarrollo y crea usuarios y datos demostrativos.'

    def add_arguments(self, parser):
        parser.add_argument('--force', action='store_true', help='Permite ejecutarlo con DEBUG desactivado.')

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG and not options['force']:
            raise CommandError('seed_demo borra todos los datos: solo se ejecuta con DEBUG=True o con --force.')
        ClinicalEvolutionSummary.objects.all().delete()
        PatientReport.objects.all().delete()
        TreatmentPlan.objects.all().delete()
        Prescription.objects.all().delete()
        UserProfile.objects.all().delete()
        User.objects.exclude(is_superuser=True).delete()

        doctor = User.objects.create_user(
            username='doctor.demo',
            password='DoctorDemo2026!',
            first_name='Laura',
            last_name='Mendoza',
            role=User.Roles.DOCTOR,
        )
        patient = User.objects.create_user(
            username='paciente.demo',
            password='PacienteDemo2026!',
            first_name='Carlos',
            last_name='Pérez',
            role=User.Roles.PATIENT,
        )
        UserProfile.objects.create(
            user=patient,
            primary_doctor=doctor,
            birth_date=date(1998, 5, 14),
            phone='0990000000',
            emergency_contact='0981111111',
        )

        Prescription.objects.create(
            doctor=doctor,
            patient=patient,
            details='Paracetamol 500 mg cada 8 horas por 3 días, según tolerancia.',
            nlp_severity='Baja',
        )
        Prescription.objects.create(
            doctor=doctor,
            patient=patient,
            details='Ibuprofeno 400 mg cada 8 horas con alimentos por 3 días.',
            nlp_severity='Media',
        )

        start_date = date.today() - timedelta(days=1)
        third_molar = ClinicalProcedure.objects.filter(code='COD-MAX-014').first()
        surgery_plan = TreatmentPlan.objects.create(
            patient=patient,
            title='Paracetamol 500 mg',
            treatment_type=TreatmentPlan.TreatmentType.MEDICATION,
            schedule_description='Cada 8 horas',
            next_due_time='14:00',
            instructions='Tómalo únicamente en el horario indicado por tu doctor.',
            side_effects='Náusea leve o malestar estomacal.',
            day_number=2,
            procedure='Extracción de tercer molar',
            clinical_procedure=third_molar,
            start_date=start_date,
            treatment_severity='Media',
            care_recommendations='Descansa y mantén tus horarios. No combines medicamentos sin consultar.',
        )
        TreatmentPlan.objects.create(
            patient=patient,
            title='Compresas frías',
            treatment_type=TreatmentPlan.TreatmentType.THERAPY,
            schedule_description='15 minutos de aplicación y 15 de descanso',
            instructions='Coloca la compresa por fuera de la mejilla, sin presionar la zona.',
            side_effects='La piel puede sentirse fría o ligeramente adormecida.',
            day_number=2,
            procedure='Extracción de tercer molar',
            clinical_procedure=third_molar,
            start_date=start_date,
            treatment_severity='Media',
            care_recommendations='No coloques hielo directamente sobre la piel.',
        )

        # Un reporte el día de la cirugía (día 0) y otro hoy (día 1), con sus fechas reales.
        for postoperative_day, eva, comparison, status in [
            (0, 7, PatientReport.Comparison.HIGHER, 'Seguimiento'),
            (1, 4, PatientReport.Comparison.LOWER, 'En descenso'),
        ]:
            day = f'Día {postoperative_day}'
            reported_at = timezone.now() - timedelta(days=1 - postoperative_day)
            report = PatientReport.objects.create(
                patient=patient,
                postoperative_day=postoperative_day,
                pain_level=eva,
                comparison=comparison,
                message='Inflamación esperada y molestia controlable.',
                nlp_severity='Baja',
                risk_level='Medio' if eva >= 5 else 'Bajo',
                recommendation='Continúa con tus cuidados y registra cómo te sientes.',
                evolution_status='Evolución favorable' if comparison == PatientReport.Comparison.LOWER else 'Seguimiento',
            )
            summary = ClinicalEvolutionSummary.objects.create(
                patient=patient,
                day_label=day,
                eva_recorded=eva,
                status_tag=status,
                clinical_notes='Recuperación posterior a extracción de tercer molar.',
            )
            PatientReport.objects.filter(pk=report.pk).update(created_at=reported_at, treatment_plan=surgery_plan)
            ClinicalEvolutionSummary.objects.filter(pk=summary.pk).update(created_at=reported_at)

        create_phases(surgery_plan, third_molar, start_date)
        self.other_specialties(doctor)

        self.stdout.write(self.style.SUCCESS('Datos demo creados correctamente.'))
        self.stdout.write('Paciente: paciente.demo / PacienteDemo2026!')
        self.stdout.write('Doctor: doctor.demo / DoctorDemo2026!')
        self.stdout.write('Otros pacientes (misma contraseña): paciente.ortodoncia, paciente.endodoncia, paciente.implante')

    def other_specialties(self, doctor):
        """Pacientes de ortodoncia, endodoncia e implantes: fases, citas, cuidados y reportes."""
        today = date.today()
        cases = [
            ('paciente.ortodoncia', 'Ana', 'Ruiz', 'ORT-001', 60, 3, [13, 23, 33, 43], [
                (3, 3, 'same', 'Me duelen un poco los dientes tras el ajuste'),
                (1, 4, 'higher', 'Se me despegó un bracket y el alambre me lastima'),
            ]),
            ('paciente.endodoncia', 'Luis', 'Mora', 'COD-END-001', 4, 4, [36], [
                (3, 5, 'same', 'Me duele al morder del lado del diente tratado'),
                (0, 6, 'higher', 'Tengo la encía hinchada alrededor del diente'),
            ]),
            ('paciente.implante', 'Rosa', 'Vera', 'COD-MAX-008', 10, 10, [46], [
                (2, 3, 'lower', 'Molestia leve, sin hinchazón'),
                (0, 2, 'lower', 'Todo bien, sin molestias'),
            ]),
        ]
        for username, first_name, last_name, code, started_days_ago, last_days_ago, teeth, reports in cases:
            patient = User.objects.create_user(
                username=username, password='PacienteDemo2026!', first_name=first_name, last_name=last_name,
                role=User.Roles.PATIENT,
            )
            UserProfile.objects.create(user=patient, primary_doctor=doctor, birth_date=date(1990, 3, 1), phone='0990000001')
            protocol = ClinicalProcedure.objects.get(code=code)
            plan = TreatmentPlan.objects.create(
                patient=patient, title=protocol.name, treatment_type=TreatmentPlan.TreatmentType.THERAPY,
                schedule_description='Controles programados', procedure=protocol.name, clinical_procedure=protocol,
                instructions='Sigue los cuidados de tu checklist diario y reporta cualquier molestia.',
                start_date=today - timedelta(days=started_days_ago),
                last_intervention_date=today - timedelta(days=last_days_ago), teeth=teeth,
                admission_reason=f'Tratamiento de {protocol.get_specialty_display().lower()}',
            )
            create_phases(plan, protocol, plan.start_date)
            # El paciente debe volver a control en 3 días: el portal ya le muestra el aviso.
            TreatmentPlan.objects.filter(pk=plan.pk).update(next_control_date=today + timedelta(days=3))
            for offset in range(5):
                items = {item: (offset + index) % 3 != 0 for index, item in enumerate(protocol.care_items)}
                CareCheckin.objects.create(treatment_plan=plan, date=today - timedelta(days=offset + 1), items=items)
            for days_ago, pain, comparison, message in reports:
                day = max(0, last_days_ago - days_ago)
                evaluation = evaluate_patient_status(pain, comparison, message, postoperative_day=day, protocol=protocol)
                report = PatientReport.objects.create(
                    patient=patient, treatment_plan=plan, pain_level=pain, comparison=comparison, message=message,
                    postoperative_day=day, nlp_severity=evaluation['severity'], extracted_entities=evaluation['entities'],
                    risk_level=evaluation['risk_level'], alert_reasons=evaluation['alert_reasons'],
                    recommendation=evaluation['recommendation'], evolution_status=evaluation['evolution_status'],
                    doctor_notified=evaluation['doctor_notified'],
                )
                PatientReport.objects.filter(pk=report.pk).update(created_at=timezone.now() - timedelta(days=days_ago))

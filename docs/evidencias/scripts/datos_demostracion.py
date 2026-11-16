# Datos de demostración realistas para las evidencias (BD desechable).
import datetime as dt
from django.core.management import call_command
from django.utils import timezone
from users.models import User, UserProfile
from medical_monitor.models import *
from medical_monitor.services import evaluate_patient_status
call_command('seed_demo', force=True)
doc = User.objects.get(username='doctor.demo')
User.objects.create_user('admin.demo', password='AdminDemo2026!', role='ADM', first_name='Ana', last_name='Salazar')
proc = {p.code: p for p in ClinicalProcedure.objects.all()}
now = timezone.now()
def patient(username, first, last, cedula, code, days_ago, story):
    u = User.objects.create_user(username, password='PacienteDemo2026!', role='PAT', first_name=first, last_name=last)
    UserProfile.objects.create(user=u, primary_doctor=doc, national_id=cedula, birth_date=dt.date(1995, 3, 2), phone='0991234567')
    surgery = timezone.localdate() - dt.timedelta(days=days_ago)
    TreatmentPlan.objects.create(patient=u, title='Ibuprofeno 400 mg', treatment_type='medication', schedule_description='Cada 8 horas',
        instructions='Ibuprofeno 400 mg cada 8 horas con alimentos durante 3 días. Compresas frías 15 minutos las primeras 48 horas.',
        procedure=proc[code].name, clinical_procedure=proc[code], start_date=surgery, medication_name='Ibuprofeno', strength='400 mg', frequency='Cada 8 horas', duration='3 días')
    Prescription.objects.create(doctor=doc, patient=u, details='Ibuprofeno 400 mg cada 8 horas con alimentos durante 3 días.', medication_name='Ibuprofeno', strength='400 mg', frequency='Cada 8 horas', duration='3 días')
    prev = None
    for day, pain, comparison, message in story:
        ev = evaluate_patient_status(pain, comparison, message, prev, day)
        r = PatientReport.objects.create(patient=u, pain_level=pain, comparison=comparison, message=message, nlp_severity=ev['severity'],
            extracted_entities=ev['entities'], doctor_notified=ev['doctor_notified'], risk_level=ev['risk_level'], recommendation=ev['recommendation'],
            evolution_status=ev['evolution_status'], alert_reasons=ev['alert_reasons'], postoperative_day=day)
        when = timezone.make_aware(dt.datetime.combine(surgery + dt.timedelta(days=day), dt.time(10, 0)))
        PatientReport.objects.filter(pk=r.pk).update(created_at=when)
        prev = r
patient('maria.torres', 'María', 'Torres', '1712345671', 'COD-MAX-014', 4, [
    (0, 7, 'same', 'Tengo dolor e inflamación después de la cirugía'), (1, 6, 'lower', 'Un poco de sangrado y la mejilla hinchada'),
    (2, 4, 'lower', 'Menos dolor, sin sangrado'), (3, 5, 'higher', 'Me duele más que ayer y siento mal sabor'), (4, 7, 'higher', 'El dolor aumentó mucho y tengo fiebre')])
patient('jorge.vera', 'Jorge', 'Vera', '1712345672', 'COD-MAX-008', 3, [
    (0, 5, 'same', 'Molestia moderada'), (1, 4, 'lower', 'Algo de inflamación'), (2, 3, 'lower', 'Mejor, poca molestia'), (3, 3, 'same', 'Todavía me sangra un poco al cepillarme')])
patient('lucia.mora', 'Lucía', 'Mora', '1712345673', 'COD-END-001', 2, [
    (0, 4, 'same', 'Dolor leve'), (1, 2, 'lower', 'Ya casi no me duele'), (2, 1, 'lower', 'Sin dolor ni inflamación')])
print('seed ok')

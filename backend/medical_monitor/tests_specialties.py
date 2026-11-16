"""Seguimiento odontológico general: PLN ampliado y reglas de triaje por especialidad."""
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from users.models import User

from .models import CareCheckin, ClinicalProcedure, TreatmentPlan
from .nlp import affirmed_symptoms, care_mentions, duration_days, extract_entities, longest_duration
from .services import evaluate_patient_status


def symptoms(text):
    return affirmed_symptoms(extract_entities(text))


class ExtendedNlpTests(TestCase):
    def test_symptoms_of_every_specialty(self):
        cases = {
            'Se me despegó un bracket': 'Aparato suelto o roto',
            'el alambre me lastima la mejilla': 'Alambre que lastima',
            'Tengo una llaga en la lengua': 'Llaga o úlcera',
            'me duele al morder': 'Dolor al morder',
            'siento sensibilidad con lo frío': 'Sensibilidad dental',
            'el implante se mueve': 'Movilidad dental',
            'la prótesis me queda floja': 'Prótesis desajustada',
            'se me cayó la calza': 'Restauración caída o fractura',
            'el diente está roto': 'Restauración caída o fractura',
            'me sangran las encías al cepillarme': 'Sangrado de encías',
            'tengo la encía retraída': 'Retracción de encía',
        }
        for text, category in cases.items():
            with self.subTest(text=text):
                self.assertIn(category, symptoms(text))

    def test_negation_still_applies_to_new_symptoms(self):
        self.assertEqual(symptoms('ya no tengo sensibilidad ni llagas'), {})

    def test_care_adherence_and_its_negation(self):
        entities = extract_entities('No me puse los elásticos ayer, pero sí usé los alineadores y me cepillé')
        self.assertEqual(care_mentions(entities), {'Elásticos': False, 'Alineadores': True, 'Cepillado': True})

    def test_duration_in_days(self):
        for text, days in (('hace 3 días', 3), ('desde ayer', 1), ('hace una semana', 7), ('hace dos semanas', 14),
                           ('desde hace unas horas', 0), ('llevo 2 meses', 60)):
            with self.subTest(text=text):
                self.assertEqual(duration_days(text), days)
        self.assertEqual(longest_duration(extract_entities('Tengo una llaga desde hace 8 días')), 8)


class SpecialtyRulesTests(TestCase):
    """Cada especialidad interpreta los mismos síntomas según su propio curso esperado."""

    def evaluate(self, code, message, pain=2, comparison='same', day=1):
        protocol = ClinicalProcedure.objects.get(code=code)
        return evaluate_patient_status(pain, comparison, message, postoperative_day=day, protocol=protocol)

    def assertLevel(self, result, level, reason=None):
        self.assertEqual(result['risk_level'], level, result['alert_reasons'])
        if reason:
            self.assertTrue(any(reason in item for item in result['alert_reasons']), result['alert_reasons'])

    def test_surgery_keeps_the_postoperative_rules(self):
        self.assertLevel(self.evaluate('COD-MAX-001', 'un poco de sangrado', day=1), 'Bajo')
        self.assertLevel(self.evaluate('COD-MAX-001', 'un poco de sangrado', day=3), 'Medio', '48 horas')
        self.assertLevel(self.evaluate('COD-MAX-014', 'me duele', pain=6, comparison='higher', day=4), 'Alto', 'alveolitis')

    def test_endodontics(self):
        self.assertLevel(self.evaluate('COD-END-001', 'tengo la encía hinchada'), 'Alto', 'absceso')
        self.assertLevel(self.evaluate('COD-END-001', 'me duele', pain=5, day=5), 'Medio', 'persiste')
        self.assertLevel(self.evaluate('COD-END-001', 'me duele al morder', day=2), 'Bajo')
        self.assertLevel(self.evaluate('COD-END-001', 'se me cayó la curación'), 'Medio', 'contaminarse')

    def test_orthodontics(self):
        self.assertLevel(self.evaluate('ORT-001', 'me duelen los dientes tras el ajuste', pain=4, day=2), 'Bajo')
        self.assertLevel(self.evaluate('ORT-001', 'se me despegó un bracket'), 'Medio', 'revisión')
        self.assertLevel(self.evaluate('ORT-001', 'el alambre me pincha'), 'Medio', 'cera')
        self.assertLevel(self.evaluate('ORT-001', 'tengo una llaga desde hace 2 días', day=2), 'Bajo')
        self.assertLevel(self.evaluate('ORT-001', 'tengo una llaga desde hace 10 días', day=10), 'Medio', 'Llaga')

    def test_periodontics(self):
        self.assertLevel(self.evaluate('PER-001', 'me sangran las encías', day=3), 'Bajo')
        self.assertLevel(self.evaluate('PER-001', 'me sangran las encías', day=10), 'Medio', 'siguen sangrando')
        self.assertLevel(self.evaluate('PER-001', 'siento el diente flojo'), 'Medio', 'periodontal')

    def test_implants(self):
        self.assertLevel(self.evaluate('COD-MAX-008', 'el implante se mueve'), 'Alto', 'Movilidad')
        self.assertLevel(self.evaluate('COD-MAX-008', 'tengo pus en la encía'), 'Alto', 'periimplantitis')

    def test_prosthodontics(self):
        self.assertLevel(self.evaluate('PRO-002', 'la dentadura se me cae al hablar'), 'Medio', 'ajuste')
        self.assertLevel(self.evaluate('PRO-002', 'me salió una llaga', day=2), 'Bajo')
        self.assertLevel(self.evaluate('PRO-002', 'tengo una llaga desde hace 10 días', day=10), 'Medio', 'no cicatriza')

    def test_restorative_aesthetic_and_pediatric(self):
        self.assertLevel(self.evaluate('OPE-001', 'tengo sensibilidad al frío', day=5), 'Bajo')
        self.assertLevel(self.evaluate('OPE-001', 'tengo sensibilidad al frío', day=20), 'Medio', 'sensibilidad')
        self.assertLevel(self.evaluate('OPE-001', 'me duele', pain=7, comparison='higher', day=3), 'Alto', 'pulpitis')
        self.assertLevel(self.evaluate('EST-001', 'mucha sensibilidad', day=5), 'Medio', 'sensibilidad')
        self.assertLevel(self.evaluate('PED-001', 'tiene la cara hinchada'), 'Alto', 'Signo de alarma')

    def test_general_alarm_signs_are_red_in_every_specialty(self):
        for code in ('ORT-002', 'OPE-001', 'PER-001', 'PRO-001'):
            with self.subTest(code=code):
                self.assertLevel(self.evaluate(code, 'tengo dificultad para respirar'), 'Alto')
                self.assertLevel(self.evaluate(code, 'tengo fiebre y pus'), 'Alto', 'infección')

    def test_a_long_lasting_ulcer_is_always_reviewed(self):
        self.assertLevel(self.evaluate('OPE-001', 'tengo una llaga desde hace dos semanas'), 'Medio', 'dos semanas')

    def test_administrator_windows_change_the_triage(self):
        protocol = ClinicalProcedure.objects.get(code='PER-001')
        protocol.expected_symptoms['Sangrado de encías'] = 14
        protocol.save()
        self.assertLevel(self.evaluate('PER-001', 'me sangran las encías', day=10), 'Bajo')


class FollowUpDayTests(TestCase):
    def test_day_counts_from_the_last_intervention(self):
        patient = User.objects.create_user('p', role=User.Roles.PATIENT)
        plan = TreatmentPlan.objects.create(
            patient=patient, title='Brackets', treatment_type='therapy', schedule_description='x', instructions='x',
            start_date=timezone.localdate() - timedelta(days=60),
        )
        self.assertEqual(plan.postoperative_day, 60)
        plan.last_intervention_date = timezone.localdate() - timedelta(days=2)
        self.assertEqual(plan.postoperative_day, 2)
        self.assertEqual(plan.specialty, 'cirugia')
        plan.clinical_procedure = ClinicalProcedure.objects.get(code='ORT-001')
        self.assertEqual(plan.specialty, 'ortodoncia')

    def test_checkin_adherence(self):
        self.assertEqual(CareCheckin(items={'a': True, 'b': False, 'c': True, 'd': True}).adherence, 75)
        self.assertEqual(CareCheckin(items={}).adherence, 0)


class NlpEvaluationTests(TestCase):
    """Evidencia de la tesis: el PLN local no puede empeorar respecto a la línea base medida."""

    def test_local_nlp_keeps_its_baseline_on_the_labeled_set(self):
        import tempfile
        from io import StringIO
        from pathlib import Path as FilePath
        from django.core.management import call_command
        with tempfile.TemporaryDirectory() as folder:
            output = FilePath(folder) / 'informe.md'
            out = StringIO()
            call_command('evaluate_nlp', output=str(output), stdout=out)
            report = output.read_text(encoding='utf-8')
        self.assertIn('124 frases', report)
        # Línea base del 14/11/2026: precisión 98,0 %, exhaustividad 84,7 %, F1 90,9 %.
        line = next(item for item in report.splitlines() if item.startswith('| PLN local'))
        precision, recall, f1 = (float(cell.strip().rstrip('%')) for cell in line.split('|')[2:5])
        self.assertGreaterEqual(precision, 95)
        self.assertGreaterEqual(recall, 84)
        self.assertGreaterEqual(f1, 90)
        # Ninguna frase sin síntomas («ya no me duele») produce síntomas.
        self.assertIn('100.0% de 15', line)


class VocabularyTests(TestCase):
    def test_vocabulary_for_the_clinical_team(self):
        from rest_framework.test import APIClient
        client = APIClient()
        admin = User.objects.create_user('admin', role=User.Roles.ADMIN)
        patient = User.objects.create_user('pac', role=User.Roles.PATIENT)
        client.force_authenticate(user=admin)
        data = client.get('/api/nlp/vocabulary/').data
        self.assertIn('Aparato suelto o roto', data['symptoms'])
        self.assertIn('Elásticos', data['care'])
        client.force_authenticate(user=patient)
        self.assertEqual(client.get('/api/nlp/vocabulary/').status_code, 403)

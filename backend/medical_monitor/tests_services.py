"""Pruebas unitarias de services.py.

Los identificadores BUG-nn remiten a defectos ya corregidos: estas pruebas evitan que vuelvan.
"""
import json
from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase

from .models import MedicationGuide
from .services import (
    analyze_medical_text,
    evaluate_patient_status,
    evaluate_treatment_plan,
    find_medication_guide,
)


class AnalyzeMedicalTextTests(SimpleTestCase):
    def test_every_high_keyword_is_alta(self):
        for text in ('Urgente', 'caso SEVERO', 'estado crítico', 'traslado inmediato',
                     'dolor intenso', 'hemorragia', 'fiebre alta'):
            with self.subTest(text=text):
                self.assertEqual(analyze_medical_text(text)['severity'], 'Alta')

    def test_every_medium_keyword_is_media(self):
        for text in ('moderado', 'control', 'observación', 'cada 8 horas', 'tratamiento prolongado'):
            with self.subTest(text=text):
                self.assertEqual(analyze_medical_text(text)['severity'], 'Media')

    def test_high_wins_over_medium(self):
        self.assertEqual(analyze_medical_text('control por hemorragia')['severity'], 'Alta')

    def test_empty_text_is_low_without_entities(self):
        self.assertEqual(analyze_medical_text(''), {'severity': 'Baja', 'entities': []})

    def test_entities_are_json_serializable(self):
        entities = analyze_medical_text('María viajó a Quito con Paracetamol')['entities']
        self.assertTrue(entities)
        json.dumps(entities)
        self.assertEqual(set(entities[0]), {'text', 'label'})

    def test_bug01_alarm_symptoms_announced_by_the_ui_are_detected(self):
        # BUG-01: la UI promete detectar estos signos, pero el texto queda en severidad Baja.
        alarms = [
            'tengo sangrado abundante',
            'sangrado persistente',
            'tengo dificultad para respirar',
            'no puedo tragar',
            'no puedo abrir la boca',
            'fiebre de 39 grados',
            'la cara está muy hinchada',
            'dolor muy intenso',
            'el dolor es insoportable',
            'estado critico',
        ]
        missed = [text for text in alarms if analyze_medical_text(text)['severity'] != 'Alta']
        self.assertEqual(missed, [])

    def test_bug02_negated_symptom_is_not_high_severity(self):
        # BUG-02: búsqueda de subcadenas sin negación: genera falsas alertas.
        self.assertNotEqual(analyze_medical_text('Ya no tengo fiebre alta ni hemorragia')['severity'], 'Alta')

    def test_bug02_keyword_inside_other_word_is_not_a_match(self):
        self.assertEqual(analyze_medical_text('Mantengo el autocontrol')['severity'], 'Baja')


class EvaluatePatientStatusTests(TestCase):
    def test_risk_thresholds(self):
        cases = [
            (1, 'same', 'Bajo'), (4, 'same', 'Bajo'), (5, 'same', 'Medio'),
            (6, 'lower', 'Medio'), (7, 'lower', 'Alto'), (8, 'same', 'Alto'), (10, 'lower', 'Alto'),
            (5, 'higher', 'Medio'), (6, 'higher', 'Alto'),
        ]
        for pain, comparison, expected in cases:
            with self.subTest(pain=pain, comparison=comparison):
                result = evaluate_patient_status(pain, comparison, '')
                self.assertEqual(result['risk_level'], expected)
                self.assertEqual(result['doctor_notified'], expected == 'Alto')

    def test_message_raises_the_risk_of_a_low_pain_level(self):
        self.assertEqual(evaluate_patient_status(1, 'same', 'tengo hemorragia')['risk_level'], 'Alto')
        self.assertEqual(evaluate_patient_status(1, 'same', 'consulta de control')['risk_level'], 'Medio')

    def test_evolution_status_by_comparison(self):
        for comparison, expected in (
            ('lower', 'Evolución favorable'),
            ('same', 'Evolución estable'),
            ('higher', 'Requiere revisión'),
        ):
            with self.subTest(comparison=comparison):
                self.assertEqual(evaluate_patient_status(2, comparison, '')['evolution_status'], expected)

    def test_each_risk_gets_its_own_recommendation(self):
        texts = {evaluate_patient_status(pain, 'same', '')['recommendation'] for pain in (1, 5, 9)}
        self.assertEqual(len(texts), 3)

    def test_bug03_eva_7_is_high_risk_as_the_ui_states(self):
        # BUG-03: UI y reglas dicen "crítico: EVA >= 7"; el backend exige 8 (o 6 si aumenta).
        self.assertEqual(evaluate_patient_status(7, 'same', '')['risk_level'], 'Alto')

    def test_bug04_max_pain_is_not_favorable_evolution(self):
        # BUG-04: riesgo Alto y "Evolución favorable" a la vez.
        self.assertNotEqual(evaluate_patient_status(10, 'lower', '')['evolution_status'], 'Evolución favorable')

    def test_bug04_previous_report_contradicting_comparison_is_used(self):
        # BUG-04: previous_report se recibe pero no cambia nada: el bloque que lo usa es código muerto.
        previous = SimpleNamespace(pain_level=3)
        result = evaluate_patient_status(8, 'lower', '', previous)
        self.assertNotEqual(result['evolution_status'], 'Evolución favorable')

    def test_bug04_mild_pain_above_previous_report_requires_review(self):
        result = evaluate_patient_status(5, 'lower', '', SimpleNamespace(pain_level=3))
        self.assertEqual(result['evolution_status'], 'Requiere revisión')

    def test_alarm_phrase_with_no_is_not_treated_as_negation(self):
        for text in ('no para la hemorragia', 'no puedo respirar'):
            with self.subTest(text=text):
                self.assertEqual(evaluate_patient_status(1, 'same', text)['risk_level'], 'Alto')


class EvaluateTreatmentPlanTests(SimpleTestCase):
    def test_third_molar_synonyms_get_specific_care(self):
        for procedure in ('3 molar', 'Tercer molar', 'muela del juicio', 'cordal'):
            with self.subTest(procedure=procedure):
                result = evaluate_treatment_plan('', procedure, '', '')
                self.assertEqual(result['severity'], 'Media')
                self.assertIn('compresas frías', result['recommendations'])

    def test_surgery_is_medium_with_general_care(self):
        for procedure in ('Cirugía', 'cirugia', 'Extracción', 'extraccion', 'Implante'):
            with self.subTest(procedure=procedure):
                result = evaluate_treatment_plan('', procedure, '', '')
                self.assertEqual(result['severity'], 'Media')
                self.assertNotIn('compresas frías', result['recommendations'])

    def test_other_procedures_are_low(self):
        self.assertEqual(evaluate_treatment_plan('Limpieza', 'Profilaxis', '', '')['severity'], 'Baja')


class FindMedicationGuideTests(TestCase):
    def test_migration_loads_the_guides(self):
        self.assertTrue(MedicationGuide.objects.filter(name='Paracetamol').exists())

    def test_finds_guide_case_insensitive(self):
        self.assertEqual(find_medication_guide('tomar PARACETAMOL 500')['name'], 'Paracetamol')

    def test_returns_none_without_match(self):
        self.assertIsNone(find_medication_guide('agua tibia con sal'))

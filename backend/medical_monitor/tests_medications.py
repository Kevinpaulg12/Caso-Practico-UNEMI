"""Vademécum de la receta rápida: local, CIMA y RxNav simulados; marcas locales y ficha del prospecto."""
import http.client
import json
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from users.models import User, UserProfile

from . import medications
from .models import AIInteraction, Medication, MedicationGuide, Prescription, TreatmentPlan
from .services import find_medication_guide


def response(payload):
    mock = MagicMock()
    mock.read.return_value = (payload if isinstance(payload, bytes) else json.dumps(payload).encode('utf-8'))
    mock.__enter__.return_value = mock
    return mock


def cima_record(registry, ingredient, dose, form='COMPRIMIDO', route='VÍA ORAL', prescription=False):
    return {'nregistro': registry, 'nombre': f'{ingredient.upper()} {dose}', 'dosis': dose, 'receta': prescription,
            'vtm': {'nombre': ingredient.lower()}, 'formaFarmaceuticaSimplificada': {'nombre': form},
            'viasAdministracion': [{'nombre': route}]}


def fake_network(cima=(), sections=None, rxnav=None, fail=None):
    """Simula CIMA (búsquedas y prospecto) y RxNav según la URL pedida."""
    sections = sections or {}

    def answer(request, timeout=None):
        url = request.full_url
        if fail is not None:
            raise fail
        if 'docSegmentado/contenido' in url:
            kind = url.split('contenido/')[1].split('?')[0]
            section = url.rsplit('seccion=', 1)[1]
            text = sections.get((kind, section))
            return response([{'seccion': section, 'contenido': f'<div><p>{text}</p></div>'}] if text else [])
        if 'cima.aemps.es' in url:
            return response({'resultados': list(cima)})
        return response(rxnav or {'drugGroup': {}})
    return answer


class LocalSearchTests(TestCase):
    def test_generic_and_brand_without_accents(self):
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network()):
            by_generic = medications.search('amoxicilina')
            by_brand = medications.search('augmentin')
            accentless = medications.search('acido hialuronico')
        names = [item['name'] for item in by_generic['items']]
        self.assertEqual(names[:2], ['Amoxicilina', 'Amoxicilina + ácido clavulánico'])
        self.assertEqual(by_brand['items'][0]['name'], 'Augmentin (Amoxicilina + ácido clavulánico)')
        self.assertEqual(by_brand['items'][0]['active_ingredient'], 'Amoxicilina + ácido clavulánico')
        self.assertEqual(accentless['items'][0]['name'], 'Ácido hialurónico')

    def test_items_bring_presentations_frequency_and_duration(self):
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network()):
            item = medications.search('ibuprofeno')['items'][0]
        self.assertEqual([option['strength'] for option in item['presentations']], ['400 mg', '600 mg', '800 mg', '100 mg/5 ml'])
        self.assertEqual((item['default_frequency'], item['duration_days']), ('Cada 8 horas', 3))
        self.assertIn('alimentos', item['with_food'])
        self.assertTrue(item['common_effects'])

    def test_the_seed_covers_every_dental_group(self):
        groups = set(Medication.objects.values_list('group', flat=True))
        self.assertTrue({'analgesico', 'aine', 'antibiotico', 'corticoide', 'antiseptico', 'antifungico',
                         'anestesico_topico'} <= groups)
        self.assertGreaterEqual(Medication.objects.count(), 30)


class CimaSearchTests(TestCase):
    def test_cima_fills_what_the_vademecum_lacks_grouped_by_ingredient(self):
        records = [cima_record('1', 'Etodolaco', '200 mg'), cima_record('2', 'Etodolaco', '300 mg', 'CÁPSULA'),
                   cima_record('3', 'Etodolaco', '200 mg')]
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network(cima=records)) as urlopen:
            result = medications.search('etodolaco')
        item = result['items'][0]
        self.assertEqual((item['name'], item['source']), ('Etodolaco', 'CIMA'))
        self.assertEqual(item['presentations'], [
            {'strength': '200 mg', 'form': 'Comprimido', 'route': 'Vía oral'},
            {'strength': '300 mg', 'form': 'Cápsula', 'route': 'Vía oral'},
        ])
        # Solo se envía el nombre del fármaco, codificado.
        self.assertTrue(all('etodolaco' in call.args[0].full_url for call in urlopen.call_args_list))

    def test_cima_results_are_cached(self):
        with override_settings(DATA_CACHE_SECONDS=60), \
                patch('medical_monitor.medications.urlopen', side_effect=fake_network(cima=[cima_record('1', 'Etodolaco', '200 mg')])) as urlopen:
            medications.search('etodolaco')
            calls = urlopen.call_count
            medications.search('etodolaco')
        self.assertEqual(urlopen.call_count, calls)

    def test_the_clinic_vademecum_answers_without_calling_external_sources(self):
        with patch('medical_monitor.medications.urlopen') as urlopen:
            result = medications.search('paracet')
            words = medications.search('amoxicilina clavulanico')
        urlopen.assert_not_called()
        self.assertEqual(result['items'][0]['name'], 'Paracetamol')
        self.assertEqual(words['items'][0]['name'], 'Amoxicilina + ácido clavulánico')

    def test_without_cima_the_doctor_is_told_and_can_type_it(self):
        for error in (URLError('down'), TimeoutError(), OSError(), http.client.IncompleteRead(b'')):
            with self.subTest(error=error), patch('medical_monitor.medications.urlopen', side_effect=fake_network(fail=error)):
                result = medications.search('etodolaco')
                self.assertEqual(result['items'], [])
                self.assertIn('CIMA no respondió', result['message'])

    def test_rxnav_is_the_last_external_source(self):
        rxnav = {'drugGroup': {'conceptGroup': [{'conceptProperties': [{'name': 'Exotic 5 MG Oral Tablet', 'rxcui': '9'}]}]}}
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network(rxnav=rxnav)):
            item = medications.search('exotic')['items'][0]
        self.assertEqual((item['source'], item['strength']), ('RxNav', '5 MG'))

    def test_unknown_brand_asks_for_its_active_ingredient(self):
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network()):
            result = medications.search('moralex')
        self.assertEqual(result['items'], [])
        self.assertIn('marca local', result['message'])

    def test_short_term_does_not_call_the_network(self):
        with patch('medical_monitor.medications.urlopen') as urlopen:
            for term in ('', ' ', 'a', None):
                self.assertEqual(medications.search(term)['items'], [])
        urlopen.assert_not_called()


class StaffFixture(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('laura', password='x', role=User.Roles.DOCTOR)
        cls.admin = User.objects.create_user('admin', password='x', role=User.Roles.ADMIN)
        cls.patient = User.objects.create_user('paciente', password='x', role=User.Roles.PATIENT)
        UserProfile.objects.create(user=cls.patient, primary_doctor=cls.doctor)


class LocalBrandTests(StaffFixture):
    def register(self, user=None, **data):
        self.client.force_authenticate(user=user or self.doctor)
        return self.client.post('/api/vademecum/', data, format='json')

    def test_a_local_brand_is_saved_with_its_ingredient_and_found_next_time(self):
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network()):
            response = self.register(brand='Moralex', active_ingredient='Ibuprofeno')
            self.assertEqual(response.status_code, 200)
            self.assertIn('Moralex', Medication.objects.get(generic_name='Ibuprofeno').brands)
            item = medications.search('moralex')['items'][0]
        self.assertEqual((item['name'], item['active_ingredient']), ('Moralex (Ibuprofeno)', 'Ibuprofeno'))
        self.assertEqual(item['presentations'][0]['strength'], '400 mg')
        # Registrar la misma marca otra vez no la duplica.
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network()):
            self.register(brand='MORALEX', active_ingredient='ibuprofeno')
        self.assertEqual(Medication.objects.get(generic_name='Ibuprofeno').brands.count('Moralex'), 1)

    def test_a_new_ingredient_takes_its_presentations_from_cima(self):
        records = [cima_record('1', 'Etodolaco', '200 mg', prescription=True), cima_record('2', 'Etodolaco', '300 mg')]
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network(cima=records)):
            response = self.register(brand='Lodine', active_ingredient='etodolaco')
        self.assertEqual(response.status_code, 201)
        medication = Medication.objects.get(generic_name='Etodolaco')
        self.assertEqual((medication.brands, medication.prescription_required), (['Lodine'], True))
        self.assertEqual([item['strength'] for item in medication.presentations], ['200 mg', '300 mg'])

    def test_validation_and_permissions(self):
        self.assertEqual(self.register(user=self.patient, brand='Moralex', active_ingredient='Ibuprofeno').status_code, 403)
        self.assertEqual(self.register(brand='M', active_ingredient='Ibuprofeno').status_code, 400)
        self.assertEqual(self.register(brand='Moralex', active_ingredient='').status_code, 400)
        medication = Medication.objects.get(generic_name='Ibuprofeno')
        self.client.force_authenticate(user=self.doctor)
        self.assertEqual(self.client.patch(f'/api/vademecum/{medication.pk}/', {'duration_days': 5}, format='json').status_code, 403)
        self.client.force_authenticate(user=self.admin)
        edited = self.client.patch(f'/api/vademecum/{medication.pk}/', {'duration_days': 5, 'brands': ['Advil']}, format='json')
        self.assertEqual((edited.status_code, edited.data['duration_days'], edited.data['brands']), (200, 5, ['Advil']))
        bad = self.client.patch(f'/api/vademecum/{medication.pk}/', {'presentations': [{'form': 'Tableta'}]}, format='json')
        self.assertEqual(bad.status_code, 400)


class SheetTests(StaffFixture):
    SECTIONS = {
        ('2', '1'): 'El etodolaco es un antiinflamatorio. Se utiliza para aliviar el dolor dental.',
        ('2', '4'): 'Puede producir dolor de estómago y náuseas.',
        ('1', '5.1'): 'Inhibe la ciclooxigenasa.',
    }

    def sheet(self, name, user=None):
        self.client.force_authenticate(user=user or self.doctor)
        return self.client.get('/api/medications/sheet/', {'name': name})

    def test_the_clinic_sheet_answers_without_the_network(self):
        with patch('medical_monitor.medications.urlopen') as urlopen:
            data = self.sheet('Buprex').data
        urlopen.assert_not_called()
        self.assertEqual(data['name'], 'Ibuprofeno')
        self.assertIn('inflamación', data['indications'])
        self.assertIn('equipo clínico', data['source_note'])

    def test_a_cima_drug_is_summarized_from_its_official_leaflet(self):
        from .ai.client import AIUnavailable  # noqa: F401  (la IA está apagada en las pruebas)
        network = fake_network(cima=[cima_record('77', 'Etodolaco', '200 mg')], sections=self.SECTIONS)
        with patch('medical_monitor.medications.urlopen', side_effect=network):
            data = self.sheet('etodolaco').data
        # Sin IA se guarda el texto oficial recortado, con su fuente.
        self.assertEqual(data['indications'], 'El etodolaco es un antiinflamatorio. Se utiliza para aliviar el dolor dental.')
        self.assertEqual(data['common_effects'], 'Puede producir dolor de estómago y náuseas.')
        self.assertEqual(data['source_note'], 'Fuente: prospecto autorizado (CIMA-AEMPS).')
        medication = Medication.objects.get(generic_name='Etodolaco')
        self.assertEqual((medication.source, medication.cima_registry, medication.sheet_ready), ('cima', '77', True))
        self.assertEqual(AIInteraction.objects.get().feature, 'medication')

    def test_with_ai_the_leaflet_is_summarized_and_only_the_drug_name_is_sent(self):
        from .tests_ai import LLM_ON, FakeClient
        output = medications.SheetOutput(para_que_sirve='Calma el dolor dental.', como_actua='Baja la inflamación.',
                                         efectos_frecuentes='Molestias de estómago.', senales_de_alarma='Heces negras.',
                                         con_alimentos='Con comida.')
        fake = FakeClient(output=output)
        network = fake_network(cima=[cima_record('77', 'Etodolaco', '200 mg')], sections=self.SECTIONS)
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake), \
                patch('medical_monitor.medications.urlopen', side_effect=network):
            data = self.sheet('etodolaco').data
        self.assertEqual((data['indications'], data['what_to_do']), ('Calma el dolor dental.', 'Con comida.'))
        self.assertEqual(data['source_note'], 'Fuente: prospecto autorizado (CIMA-AEMPS), resumido por IA.')
        sent = json.loads(fake.calls[0]['contents'])
        self.assertEqual(set(sent), {'medicamento', 'prospecto'})
        self.assertIn('Se utiliza para aliviar el dolor dental', sent['prospecto']['para_que_sirve'])

    def test_not_found_validation_and_permissions(self):
        with patch('medical_monitor.medications.urlopen', side_effect=fake_network()):
            self.assertEqual(self.sheet('moralex').status_code, 404)
        self.assertEqual(self.sheet('ab').status_code, 400)
        self.assertEqual(self.sheet('Ibuprofeno', user=self.patient).status_code, 403)


class PatientGuidanceTests(StaffFixture):
    def test_the_prescription_shows_what_it_is_for_and_the_longest_name_wins(self):
        plan = TreatmentPlan.objects.create(
            patient=self.patient, title='Augmentin', treatment_type='medication', schedule_description='Cada 12 horas',
            instructions='Augmentin 875/125 mg cada 12 horas',
        )
        Prescription.objects.create(doctor=self.doctor, patient=self.patient, treatment_plan=plan,
                                    details='Amoxicilina + ácido clavulánico 875/125 mg cada 12 horas',
                                    medication_name='Amoxicilina + ácido clavulánico')
        self.client.force_authenticate(user=self.patient)
        guidance = self.client.get('/api/prescriptions/').data['results'][0]['medication_guidance']
        self.assertEqual(guidance['name'], 'Amoxicilina + ácido clavulánico')
        self.assertIn('infecciones', guidance['indications'])
        self.assertTrue(guidance['mechanism'])
        # La marca también encuentra su guía.
        self.assertEqual(find_medication_guide('Tomar Augmentin')['name'], 'Amoxicilina + ácido clavulánico')

    def test_the_clinic_guide_wins_and_is_enriched_by_the_vademecum(self):
        guide = MedicationGuide.objects.get(name='Paracetamol')
        found = find_medication_guide('Paracetamol 500 mg cada 8 horas')
        self.assertEqual((found['common_effects'], found['source_note']), (guide.common_effects, guide.source_note))
        self.assertIn('dolor', found['indications'])
        self.assertIsNone(find_medication_guide('agua tibia con sal'))


class SheetAfterConsultationTests(StaffFixture):
    def test_prescribing_a_drug_without_sheet_prepares_it_after_saving(self):
        from .models import ClinicalProcedure
        from .tests_support import sample_clinical_data
        procedure = ClinicalProcedure.objects.get(code='COD-MAX-001')
        network = fake_network(cima=[cima_record('77', 'Etodolaco', '200 mg')], sections=SheetTests.SECTIONS)
        self.client.force_authenticate(user=self.doctor)
        with patch('medical_monitor.medications.urlopen', side_effect=network), self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/consultations/', {
                'patient': self.patient.pk, 'clinical_procedure': procedure.pk, 'admission_reason': 'Dolor dental',
                'clinical_data': sample_clinical_data(procedure), 'medication_name': 'Etodolaco',
                'active_ingredient': 'Etodolaco', 'strength': '200 mg', 'dosage_form': 'Comprimido',
                'frequency': 'Cada 12 horas', 'duration': '3 días', 'instructions': 'Dieta blanda y frío local.',
            }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(Medication.objects.get(generic_name='Etodolaco').sheet_ready)

    def test_a_drug_with_sheet_does_not_call_the_network(self):
        with patch('medical_monitor.medications.urlopen') as urlopen, self.captureOnCommitCallbacks(execute=True):
            medications.prepare_sheet_later('Ibuprofeno')
        urlopen.assert_not_called()


class LoadVademecumCommandTests(TestCase):
    """La clínica amplía su vademécum con un JSON investigado por el equipo."""

    def write(self, medications_list):
        import tempfile
        handle = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8')
        json.dump({'medications': medications_list}, handle, ensure_ascii=False)
        handle.close()
        return handle.name

    def item(self, **overrides):
        return {
            'generic': 'Fármaco de prueba', 'brands': ['Arcoxia'], 'group': 'aine',
            'presentations': [{'strength': '90 mg', 'form': 'Tableta', 'route': 'Oral'}],
            'frequencies': ['Cada 24 horas'], 'default_frequency': 'Cada 24 horas', 'duration_days': 3,
            'with_food': 'Con o sin alimentos.', 'indications': 'Alivia el dolor y la inflamación.',
            'mechanism': 'Bloquea la COX-2.', 'common_effects': 'Acidez, mareo.',
            'warning_signs': 'Dolor en el pecho o heces negras.', 'prescription_required': True, **overrides,
        }

    def call(self, *items, dry_run=False):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        args = ['--file', self.write(list(items))] + (['--dry-run'] if dry_run else [])
        call_command('load_vademecum', *args, stdout=out)
        return out.getvalue()

    def test_creates_updates_and_keeps_brands_registered_by_the_dentists(self):
        self.assertIn('1 nuevos', self.call(self.item()))
        Medication.objects.filter(generic_name='Fármaco de prueba').update(brands=['Arcoxia', 'Moralex'])
        self.assertIn('1 actualizados', self.call(self.item(generic='fármaco de prueba', brands=['Exxiv'], duration_days=5)))
        medication = Medication.objects.get(generic_name='Fármaco de prueba')
        self.assertEqual((medication.brands, medication.duration_days), (['Arcoxia', 'Moralex', 'Exxiv'], 5))
        self.assertTrue(medication.sheet_ready)
        # Queda disponible en la búsqueda local de la receta, también por marca.
        self.assertEqual(medications.search_local('exxiv')[0]['name'], 'Exxiv (Fármaco de prueba)')

    def test_an_invalid_file_saves_nothing_and_lists_every_error(self):
        from django.core.management.base import CommandError
        before = Medication.objects.count()
        with self.assertRaises(CommandError) as raised:
            self.call(self.item(), self.item(generic='Otro', group='vitamina', default_frequency='Cada 2 horas', presentations=[{}]))
        message = str(raised.exception)
        for text in ('grupo «vitamina»', 'presentación 1', 'default_frequency'):
            self.assertIn(text, message)
        self.assertEqual(Medication.objects.count(), before)

    def test_dry_run_only_validates(self):
        self.assertIn('válidos', self.call(self.item(), dry_run=True))
        self.assertFalse(Medication.objects.filter(generic_name='Fármaco de prueba').exists())

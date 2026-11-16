"""Capa de IA: anonimización, cliente con alternativa local, asistente, resumen y explicaciones.

Ninguna prueba llama al modelo real: el cliente de Google Gemini se sustituye por uno simulado.
"""
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import httpx2
from django.test import TestCase, override_settings
from pydantic import BaseModel
from django.utils import timezone
from rest_framework.test import APITestCase

from users.models import User, UserProfile

from .ai import assistant
from .ai.anonymize import age_text, mask, plan_context
from .ai.client import AIUnavailable, partial_string_field, structured_call
from .ai.explain import ASK_DOCTOR
from .models import AIInteraction, AssistantMessage, ClinicalProcedure, ClinicalSummary, PatientReport, TreatmentPlan

LLM_ON = {'AI_ENABLED': True, 'GEMINI_API_KEY': 'clave-de-prueba', 'AI_MODEL': 'gemini-2.5-flash'}


class Ok(BaseModel):
    ok: bool


class FakeClient:
    """Imita client.models.generate_content (google-genai) y guarda lo que se le envió."""

    def __init__(self, output=None, error=None, finish_reason='STOP', block_reason=None):
        self.output, self.error = output, error
        self.finish_reason, self.block_reason = finish_reason, block_reason
        self.calls = []
        self.models = SimpleNamespace(
            generate_content=self.generate_content, generate_content_stream=self.generate_content_stream,
        )

    def generate_content_stream(self, **kwargs):
        """La misma respuesta, entregada en trozos de 12 caracteres como hace el servicio real."""
        whole = self.generate_content(**kwargs)
        text = whole.text or ''
        for start in range(0, len(text), 12):
            yield SimpleNamespace(
                model_version=whole.model_version, text=text[start:start + 12], prompt_feedback=whole.prompt_feedback,
                candidates=whole.candidates if start + 12 >= len(text) else [], usage_metadata=whole.usage_metadata,
            )

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        output = self.output(kwargs) if callable(self.output) else self.output
        return SimpleNamespace(
            model_version='gemini-2.5-flash',
            text=output.model_dump_json() if output is not None else None,
            candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name=self.finish_reason))],
            prompt_feedback=SimpleNamespace(block_reason=self.block_reason) if self.block_reason else None,
            usage_metadata=SimpleNamespace(prompt_token_count=1200, candidates_token_count=80,
                                           cached_content_token_count=1000),
        )


def with_llm(client):
    """Activa la IA con el cliente simulado."""
    def decorator(test):
        test = patch('medical_monitor.ai.client.get_client', return_value=client)(test)
        return override_settings(**LLM_ON)(test)
    return decorator


class AIFixture(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.doctor = User.objects.create_user('laura', password='x', role=User.Roles.DOCTOR, first_name='Laura')
        cls.patient = User.objects.create_user(
            'paciente.1712345678', password='x', role=User.Roles.PATIENT, first_name='Kevin', last_name='Dávila',
        )
        UserProfile.objects.create(
            user=cls.patient, primary_doctor=cls.doctor, national_id='1712345678',
            birth_date=timezone.localdate() - timedelta(days=365 * 34),
        )
        cls.protocol = ClinicalProcedure.objects.get(code='ORT-001')
        cls.plan = TreatmentPlan.objects.create(
            patient=cls.patient, title='Brackets', treatment_type='therapy', schedule_description='Controles mensuales',
            instructions='Cepíllate después de cada comida. No comas alimentos duros. Usa los elásticos todo el día.',
            procedure='Ortodoncia con brackets', clinical_procedure=cls.protocol,
            start_date=timezone.localdate() - timedelta(days=40), teeth=[13, 23],
            last_intervention_date=timezone.localdate() - timedelta(days=2),
        )

    def login(self, user):
        self.client.force_authenticate(user=user)


class AnonymizationTests(TestCase):
    def test_personal_data_is_masked(self):
        patient = SimpleNamespace(first_name='José María', last_name='Dávila')
        text = 'Soy JOSE maria davila, cédula 1712345678, cel 099 123 4567, jose@correo.ec, el 12/10/2026'
        masked = mask(text, patient)
        for leaked in ('JOSE', 'maria', 'davila', '1712345678', '099 123 4567', 'jose@correo.ec', '12/10/2026'):
            self.assertNotIn(leaked, masked)
        self.assertIn('[NOMBRE]', masked)
        self.assertIn('[NÚMERO]', masked)

    def test_age_is_sent_in_exact_years(self):
        self.assertEqual(age_text(34), '34 años')
        self.assertEqual(age_text(1), '1 año')
        self.assertEqual(age_text(None), 'edad no registrada')


class ClientTests(AIFixture):
    def test_disabled_ai_uses_the_local_alternative_and_is_logged(self):
        with self.assertRaises(AIUnavailable):
            structured_call('summary', system='s', user='u', output_format=None)
        self.assertTrue(AIInteraction.objects.get().fallback_used)

    def test_without_api_key_the_ai_stays_off(self):
        with override_settings(AI_ENABLED=True, GEMINI_API_KEY=''), self.assertRaises(AIUnavailable):
            structured_call('summary', system='s', user='u', output_format=Ok)
        self.assertEqual(AIInteraction.objects.get().error, 'IA desactivada')

    @with_llm(FakeClient(output=Ok(ok=True)))
    def test_successful_call_asks_for_json_with_the_schema_and_logs_tokens(self, client):
        output, model = structured_call('summary', system='Reglas', user='{}', output_format=Ok, effort='low')
        self.assertTrue(output.ok)
        self.assertEqual(model, 'gemini-2.5-flash')
        call = client.return_value.calls[0]
        self.assertEqual((call['model'], call['contents']), ('gemini-2.5-flash', '{}'))
        self.assertEqual(call['config'].system_instruction, 'Reglas')
        self.assertEqual(call['config'].response_mime_type, 'application/json')
        self.assertEqual(call['config'].response_json_schema, Ok.model_json_schema())
        record = AIInteraction.objects.get()
        self.assertEqual((record.input_tokens, record.cache_read_tokens, record.fallback_used), (1200, 1000, False))

    def test_blocks_timeouts_and_service_errors_fall_back(self):
        from google.genai import errors as genai_errors
        request = httpx.Request('POST', 'https://generativelanguage.googleapis.com/v1beta/models')
        cases = (
            (FakeClient(output=Ok(ok=True), finish_reason='SAFETY'), 'bloqueó la respuesta'),
            (FakeClient(output=Ok(ok=True), block_reason='SAFETY'), 'bloqueó la solicitud'),
            (FakeClient(output=Ok(ok=True), finish_reason='MAX_TOKENS'), 'incompleta'),
            (FakeClient(error=httpx.ReadTimeout('lento', request=request)), 'Tiempo de espera'),
            (FakeClient(error=httpx.ConnectError('sin red', request=request)), 'Sin conexión'),
            # google-genai 3.x usa httpx2 internamente: sus errores también deben caer en la alternativa local.
            (FakeClient(error=httpx2.ReadTimeout('lento')), 'Tiempo de espera'),
            (FakeClient(error=httpx2.ConnectError('sin red')), 'Sin conexión'),
            (FakeClient(error=genai_errors.ClientError(429, {'error': {'message': 'cuota'}})), 'Límite de uso'),
            (FakeClient(error=genai_errors.ClientError(403, {'error': {'message': 'clave'}})), 'Clave de API'),
            (FakeClient(error=genai_errors.ServerError(503, {'error': {'message': 'caído'}})), 'Error del servicio'),
        )
        for fake, message in cases:
            with self.subTest(message=message), override_settings(**LLM_ON), \
                    patch('medical_monitor.ai.client.get_client', return_value=fake):
                with self.assertRaises(AIUnavailable):
                    structured_call('summary', system='s', user='u', output_format=Ok)
                self.assertIn(message, AIInteraction.objects.latest('id').error)

    def test_plan_context_has_no_identifiers(self):
        context = json.dumps(plan_context(self.plan), ensure_ascii=False)
        birth_date = self.patient.profile.birth_date
        for leaked in ('Kevin', 'Dávila', '1712345678', str(self.plan.start_date), str(birth_date), str(birth_date.year)):
            self.assertNotIn(leaked, context)
        self.assertIn('Ortodoncia', context)
        # La edad va exacta (la fecha de nacimiento está en la ficha), no como un rango.
        self.assertIn(f'"edad": "{self.patient.age} años"', context)


class AssistantLocalTests(AIFixture):
    """Sin IA, el asistente sigue el protocolo del tratamiento."""

    def say(self, text='', **extra):
        self.login(self.patient)
        return self.client.post('/api/assistant/messages/', {'text': text, **extra}, format='json')

    def test_guided_conversation_until_the_report_is_sent(self):
        first = self.say('Se me despegó un bracket')
        self.assertEqual(first.status_code, 201)
        self.assertIn('Del 0 al 10', first.data['message']['text'])
        self.assertEqual(first.data['conversation']['collected']['symptoms'], {'Aparato suelto o roto': None})

        second = self.say('un 4')
        self.assertEqual(second.data['conversation']['collected']['pain_level'], 4)
        self.assertIn('mejor, igual o peor', second.data['message']['text'])

        third = self.say('igual que ayer')
        # Ahora pregunta lo que indica el protocolo de ortodoncia para ese síntoma.
        self.assertIn('bracket, el alambre o una liga', third.data['message']['text'])
        self.assertFalse(third.data['ready_to_submit'])

        reply = self.say('un bracket de abajo')
        while not reply.data['ready_to_submit']:
            reply = self.say('nada más')
        conversation = reply.data['conversation']['id']
        sent = self.client.post('/api/assistant/submit/', {'conversation': conversation}, format='json')
        self.assertEqual(sent.status_code, 201)
        # Triaje local con las reglas de ortodoncia: aparato suelto -> amarillo.
        self.assertEqual(sent.data['alert_color'], 'amarillo')
        report = PatientReport.objects.get()
        self.assertEqual((report.pain_level, report.comparison, report.treatment_plan), (4, 'same', self.plan))
        self.assertIn('Se me despegó un bracket', report.message)
        self.assertEqual(self.client.post('/api/assistant/submit/', {'conversation': conversation}, format='json').status_code, 400)

    def test_numbers_that_are_not_pain_are_ignored(self):
        self.assertIsNone(self.say('tengo 2 llagas').data['conversation']['collected']['pain_level'])
        self.assertEqual(assistant.parse_pain('me duele como un 7'), 7)
        self.assertEqual(assistant.parse_pain('6/10'), 6)

    def test_chips_send_pain_and_comparison_directly(self):
        response = self.say('', pain_level=3, comparison='lower')
        collected = response.data['conversation']['collected']
        self.assertEqual((collected['pain_level'], collected['comparison']), (3, 'lower'))

    def test_cannot_submit_without_pain_and_comparison(self):
        conversation = self.say('me duele un poco').data['conversation']['id']
        response = self.client.post('/api/assistant/submit/', {'conversation': conversation}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_roles_and_preconditions(self):
        self.login(self.doctor)
        self.assertEqual(self.client.post('/api/assistant/messages/', {'text': 'hola'}, format='json').status_code, 403)
        TreatmentPlan.objects.update(is_active=False)
        self.assertEqual(self.say('hola').status_code, 400)
        self.assertEqual(self.say('x' * 1001).status_code, 400)

    def test_the_open_conversation_is_restored(self):
        self.say('me duele un poco')
        self.login(self.patient)
        current = self.client.get('/api/assistant/messages/').data
        self.assertEqual(len(current['conversation']['messages']), 2)
        self.assertFalse(current['ai_enabled'])


class AssistantLLMTests(AIFixture):
    def llm_turn(self, **fields):
        defaults = {'respuesta': 'Entiendo.', 'pregunta': '¿Algo más?', 'dolor_eva': None, 'comparacion': None,
                    'sintomas': [], 'cuidados': [], 'listo_para_enviar': False}
        return assistant.AssistantTurn(**{**defaults, **fields})

    def test_the_llm_writes_the_reply_but_never_the_triage(self):
        turn = self.llm_turn(
            respuesta='Gracias, Kevin.', pregunta=None, dolor_eva=2, comparacion='lower', listo_para_enviar=True,
            # El modelo «cree» ver un signo de alarma que el paciente no escribió.
            sintomas=[assistant.ExtractedSymptom(categoria='Dificultad para tragar o respirar')],
        )
        fake = FakeClient(output=turn)
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.login(self.patient)
            response = self.client.post('/api/assistant/messages/', {'text': 'Estoy mejor, un 2 de dolor'}, format='json')
            self.assertEqual(response.data['source'], 'llm')
            self.assertTrue(response.data['ready_to_submit'])
            sent = self.client.post('/api/assistant/submit/', {'conversation': response.data['conversation']['id']},
                                    format='json')
        # El nivel lo decide el PLN local sobre el texto del paciente: verde.
        self.assertEqual(sent.data['alert_color'], 'verde')
        # Lo que entendió el modelo queda registrado para compararlo con el PLN local.
        llm_view = PatientReport.objects.get().conversation.messages.filter(source='llm').get().extracted['llm']
        self.assertEqual(llm_view['sintomas'][0]['categoria'], 'Dificultad para tragar o respirar')

    def test_what_reaches_the_model_is_anonymized(self):
        fake = FakeClient(output=self.llm_turn())
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.login(self.patient)
            self.client.post('/api/assistant/messages/', {'text': 'Soy Kevin Dávila, mi cédula es 1712345678'}, format='json')
        sent = fake.calls[0]['contents']
        for leaked in ('Kevin', 'Dávila', '1712345678'):
            self.assertNotIn(leaked, sent)
        # El catálogo de protocolos va en el prompt de sistema (estable, aprovecha la caché implícita).
        self.assertIn('ORT-001', fake.calls[0]['config'].system_instruction)

    def test_pain_from_the_model_is_only_accepted_if_the_patient_wrote_it(self):
        fake = FakeClient(output=self.llm_turn(dolor_eva=9))
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.login(self.patient)
            response = self.client.post('/api/assistant/messages/', {'text': 'me molesta el alambre'}, format='json')
        self.assertIsNone(response.data['conversation']['collected']['pain_level'])

    def test_if_the_model_fails_the_conversation_goes_on(self):
        request = httpx.Request('POST', 'https://generativelanguage.googleapis.com/v1beta/models')
        fake = FakeClient(error=httpx.ReadTimeout('lento', request=request))
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.login(self.patient)
            response = self.client.post('/api/assistant/messages/', {'text': 'me duele'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['source'], 'local')
        self.assertIn('Del 0 al 10', response.data['message']['text'])


class AssistantStreamTests(AssistantLLMTests):
    def events(self, response):
        body = b''.join(response.streaming_content).decode()
        events = []
        for block in body.strip().split('\n\n'):
            name, data = block.split('\n')
            events.append((name.removeprefix('event: '), json.loads(data.removeprefix('data: '))))
        return events

    def test_partial_json_is_read_as_it_arrives(self):
        self.assertEqual(partial_string_field(r'{"respuesta": "Hola, \"Ana\"\n¿C', 'respuesta'), 'Hola, "Ana"\n¿C')
        # Un escape a medias no rompe la lectura: se espera a que llegue completo.
        self.assertEqual(partial_string_field(r'{"respuesta": "Hola\u00', 'respuesta'), 'Hola')
        self.assertEqual(partial_string_field('{"respuesta": "Listo.", "pregunta": "¿Y', 'respuesta'), 'Listo.')
        self.assertEqual(partial_string_field('{"pregun', 'respuesta'), '')

    def test_the_reply_is_streamed_and_ends_with_the_full_result(self):
        fake = FakeClient(output=self.llm_turn(respuesta='Gracias por contarme cómo te sientes hoy.', pregunta='¿Tienes fiebre?'))
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.login(self.patient)
            response = self.client.post('/api/assistant/messages/stream/', {'text': 'me molesta el alambre'}, format='json')
            self.assertEqual(response['Content-Type'], 'text/event-stream; charset=utf-8')
            events = self.events(response)
        deltas = [data['text'] for kind, data in events if kind == 'delta']
        self.assertGreater(len(deltas), 1)
        # Cada fragmento amplía el anterior hasta completar la respuesta.
        self.assertTrue(all(later.startswith(earlier) for earlier, later in zip(deltas, deltas[1:])))
        self.assertEqual(deltas[-1], 'Gracias por contarme cómo te sientes hoy.')
        kind, done = events[-1]
        self.assertEqual((kind, done['source']), ('done', 'llm'))
        self.assertEqual(done['message']['text'], 'Gracias por contarme cómo te sientes hoy. ¿Tienes fiebre?')
        self.assertEqual(AssistantMessage.objects.filter(role='assistant').count(), 1)
        self.assertFalse(AIInteraction.objects.get().fallback_used)

    def test_without_ai_the_stream_answers_at_once_with_the_local_reply(self):
        self.login(self.patient)
        events = self.events(self.client.post('/api/assistant/messages/stream/', {'text': 'me duele'}, format='json'))
        self.assertEqual([kind for kind, _ in events], ['done'])
        self.assertEqual(events[0][1]['source'], 'local')

    def test_if_the_model_fails_midway_the_local_reply_takes_over(self):
        fake = FakeClient(output=self.llm_turn(respuesta='Entiendo lo que me cuentas.'), finish_reason='SAFETY')
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.login(self.patient)
            events = self.events(self.client.post('/api/assistant/messages/stream/', {'text': 'me duele'}, format='json'))
        self.assertEqual((events[-1][0], events[-1][1]['source']), ('done', 'local'))
        self.assertIn('Del 0 al 10', events[-1][1]['message']['text'])

    def test_invalid_messages_and_other_roles_get_a_normal_error(self):
        self.login(self.patient)
        self.assertEqual(self.client.post('/api/assistant/messages/stream/', {'text': ''}, format='json').status_code, 400)
        self.login(self.doctor)
        self.assertEqual(self.client.post('/api/assistant/messages/stream/', {'text': 'hola'}, format='json').status_code, 403)


class SummaryTests(AIFixture):
    def report(self, pain, message, risk='Bajo', day=1):
        return PatientReport.objects.create(
            patient=self.patient, treatment_plan=self.plan, pain_level=pain, comparison='same', message=message,
            risk_level=risk, postoperative_day=day, alert_reasons=['Aparato suelto'] if risk != 'Bajo' else [],
            extracted_entities=[{'label': 'SINTOMA', 'category': 'Dolor', 'negated': False}],
        )

    def test_local_summary_without_ai(self):
        self.report(5, 'me duele')
        self.report(2, 'mejor', risk='Medio')
        self.login(self.doctor)
        response = self.client.post(f'/api/treatment-plans/{self.plan.pk}/summary/')
        self.assertEqual(response.status_code, 201)
        content = response.data['content']
        self.assertEqual(response.data['source'], 'local')
        self.assertIn('EVA 5 → 2', content['resumen'])
        self.assertIn('Aparato suelto', content['alertas'])
        self.assertIn('no sustituye', content['aviso'])
        self.assertEqual(self.client.get(f'/api/treatment-plans/{self.plan.pk}/summary/').data['id'], response.data['id'])

    def test_summary_with_the_model_and_permissions(self):
        self.report(6, 'Kevin aquí, el alambre me lastima')
        from .ai.summaries import SummaryOutput
        fake = FakeClient(output=SummaryOutput(resumen='Evolución estable.', adherencia='Buena.'))
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.login(self.doctor)
            response = self.client.post(f'/api/treatment-plans/{self.plan.pk}/summary/')
        self.assertEqual((response.data['source'], response.data['content']['resumen']), ('llm', 'Evolución estable.'))
        self.assertNotIn('Kevin', fake.calls[0]['contents'])
        self.login(self.patient)
        self.assertEqual(self.client.get(f'/api/treatment-plans/{self.plan.pk}/summary/').status_code, 403)

    def test_summary_knows_the_controls_and_the_treatment_data(self):
        from .ai.summaries import SummaryOutput
        from .models import ControlVisit
        today = timezone.localdate()
        TreatmentPlan.objects.filter(pk=self.plan.pk).update(
            clinical_data={'aparato': 'Brackets metálicos', 'arcadas': 'Ambas'}, next_control_date=today - timedelta(days=5),
        )
        ControlVisit.objects.create(
            treatment_plan=self.plan, doctor=self.doctor, date=today - timedelta(days=33),
            notes='Kevin refiere roce del arco.', clinical_data={'higiene': 'Regular', 'reparacion': True},
        )
        fake = FakeClient(output=SummaryOutput(resumen='Estable.', adherencia='Buena.'))
        self.login(self.doctor)
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.client.post(f'/api/treatment-plans/{self.plan.pk}/summary/')
        payload = json.loads(fake.calls[0]['contents'])
        self.assertEqual(payload['proximo_control_en_dias'], -5)
        self.assertEqual(payload['datos_del_tratamiento'], {'Tipo de aparato': 'Brackets metálicos', 'Arcadas tratadas': 'Ambas'})
        control = payload['controles_realizados'][0]
        self.assertEqual(control['datos'], {'Higiene oral': 'Regular', 'Se reparó un bracket o aparato suelto': 'Sí'})
        self.assertEqual((control['dia_del_tratamiento'], control['notas']), (7, '[NOMBRE] refiere roce del arco.'))
        self.assertEqual(payload['contexto_del_tratamiento']['edad'], f'{self.patient.age} años')
        # Sin IA, el resumen local avisa del control atrasado.
        local = self.client.post(f'/api/treatment-plans/{self.plan.pk}/summary/').data['content']
        self.assertIn('El control está atrasado 5 día(s): el paciente no ha vuelto a consulta.', local['puntos_a_revisar'])

    def test_a_red_alert_prepares_a_summary_for_the_doctor(self):
        self.login(self.patient)
        # El resumen se prepara al confirmar la transacción, fuera de la respuesta al paciente.
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/patient-reports/', {
                'pain_level': 9, 'comparison': 'higher', 'message': 'no puedo respirar bien',
            }, format='json')
        self.assertEqual(response.data['alert_color'], 'rojo')
        self.assertEqual(ClinicalSummary.objects.filter(treatment_plan=self.plan).count(), 1)


class ExplanationTests(AIFixture):
    def test_local_explanation_uses_only_the_doctor_text(self):
        self.login(self.patient)
        response = self.client.get(f'/api/treatment-plans/{self.plan.pk}/explanation/')
        self.assertEqual(response.status_code, 200)
        content = response.data['content']
        self.assertIn('Cepíllate después de cada comida', content['pasos'])
        self.assertIn('No comas alimentos duros', content['que_evitar'])
        self.assertEqual(response.data['source'], 'local')

    def test_explanation_is_regenerated_when_the_instructions_change(self):
        from .ai.explain import ExplanationOutput
        fake = FakeClient(output=ExplanationOutput(resumen='Tu ortodoncia.', pasos=['Lávate los dientes.']))
        with override_settings(**LLM_ON), patch('medical_monitor.ai.client.get_client', return_value=fake):
            self.login(self.patient)
            url = f'/api/treatment-plans/{self.plan.pk}/explanation/'
            self.client.get(url)
            self.client.get(url)
            self.assertEqual(len(fake.calls), 1)
            TreatmentPlan.objects.filter(pk=self.plan.pk).update(instructions='Usa cera si el alambre lastima.')
            self.assertEqual(self.client.get(url).data['source'], 'llm')
            self.assertEqual(len(fake.calls), 2)

    def test_questions_are_answered_only_from_the_instructions(self):
        self.login(self.patient)
        url = f'/api/treatment-plans/{self.plan.pk}/ask/'
        grounded = self.client.post(url, {'question': '¿Puedo comer alimentos duros?'}, format='json').data
        self.assertTrue(grounded['grounded'])
        self.assertIn('alimentos duros', grounded['answer'])
        unknown = self.client.post(url, {'question': '¿Puedo ir a nadar?'}, format='json').data
        self.assertEqual((unknown['grounded'], unknown['answer']), (False, ASK_DOCTOR))
        self.assertEqual(self.client.post(url, {'question': 'x'}, format='json').status_code, 400)
        self.login(self.doctor)
        self.assertEqual(self.client.post(url, {'question': '¿Puedo comer?'}, format='json').status_code, 403)


class MetricsTests(AIFixture):
    def test_admin_sees_ai_usage(self):
        AIInteraction.objects.create(feature='assistant', model='gemini-2.5-flash', latency_ms=800, input_tokens=100)
        AIInteraction.objects.create(feature='assistant', fallback_used=True, error='Tiempo de espera agotado')
        admin = User.objects.create_user('admin', role=User.Roles.ADMIN)
        self.login(admin)
        data = self.client.get('/api/ai/metrics/').data
        row = data['features'][0]
        self.assertEqual((row['total'], row['llm'], row['fallback_rate'], row['avg_latency_ms']), (2, 1, 50, 800))
        self.assertEqual(data['errors'][0]['error'], 'Tiempo de espera agotado')
        self.login(self.doctor)
        self.assertEqual(self.client.get('/api/ai/metrics/').status_code, 403)
        self.assertEqual(self.client.get('/api/ai/status/').data, {'enabled': False, 'model': None})

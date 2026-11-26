"""Checklist de cuidados, recordatorios, asistente conversacional y métricas de la IA."""
import json
import logging
from datetime import date, timedelta

from django.conf import settings
from django.db import models
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.utils.encoders import JSONEncoder
from rest_framework.views import APIView

from users.models import User, patients_of

from .ai import assistant
from .ai.client import ai_enabled
from .audit import record_audit
from .models import AIInteraction, AppointmentRequest, CareCheckin, TreatmentPlan
from .nlp import CARE, SYMPTOMS
from .reminders import pending_for_plan
from .reports import NO_ACTIVE_PLAN, active_plan
from .appointments import cancel as cancel_appointment
from .serializers_followup import (
    AppointmentRequestSerializer,
    CancelAppointmentSerializer,
    CareCheckinSerializer,
)

logger = logging.getLogger(__name__)


def doctor_plans(doctor):
    return TreatmentPlan.objects.filter(patient__in=patients_of(doctor))


def care_template(plan):
    """Cuidados del día: los del protocolo del tratamiento."""
    items = list(getattr(plan.clinical_procedure, 'care_items', None) or [])
    if plan.medication_name and not any('medica' in item.lower() for item in items):
        items.append(f'Tomar {plan.medication_name} {plan.frequency.lower()}'.strip())
    return items


class CareCheckinView(APIView):
    """GET: checklist de hoy (paciente) o historial de adherencia (?plan=, odontólogo). POST: marcar el día."""

    def get(self, request):
        user = request.user
        if user.role == User.Roles.DOCTOR:
            plan_id = request.query_params.get('plan', '')
            if not plan_id.isdigit():
                raise ValidationError({'plan': 'Indica el tratamiento.'})
            plan = doctor_plans(user).filter(pk=plan_id).first()
            if plan is None:
                return Response(status=status.HTTP_404_NOT_FOUND)
            checkins = plan.checkins.order_by('-date')[:60]
            return Response({
                'items': care_template(plan),
                'checkins': CareCheckinSerializer(checkins, many=True).data,
                'adherence_7_days': adherence(plan, 7),
            })
        if user.role != User.Roles.PATIENT:
            raise PermissionDenied('Solo el paciente y su odontólogo consultan los cuidados.')
        plan = active_plan(user)
        if plan is None:
            return Response({'items': [], 'today': None, 'history': [], 'adherence_7_days': None})
        today = plan.checkins.filter(date=timezone.localdate()).first()
        return Response({
            'treatment_plan': plan.pk,
            'items': care_template(plan),
            'today': CareCheckinSerializer(today).data if today else None,
            'history': CareCheckinSerializer(plan.checkins.order_by('-date')[:14], many=True).data,
            'adherence_7_days': adherence(plan, 7),
        })

    def post(self, request):
        if request.user.role != User.Roles.PATIENT:
            raise PermissionDenied('Solo el paciente registra sus cuidados.')
        plan = active_plan(request.user)
        if plan is None:
            raise ValidationError({'detail': NO_ACTIVE_PLAN})
        serializer = CareCheckinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        allowed = set(care_template(plan))
        items = {key: value for key, value in serializer.validated_data['items'].items() if key in allowed}
        if not items:
            raise ValidationError({'items': 'Marca los cuidados de tu lista.'})
        checkin, created = CareCheckin.objects.update_or_create(
            treatment_plan=plan, date=timezone.localdate(), defaults={'items': items},
        )
        return Response(CareCheckinSerializer(checkin).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


def adherence(plan, days):
    since = timezone.localdate() - timedelta(days=days - 1)
    checkins = list(plan.checkins.filter(date__gte=since))
    if not checkins:
        return None
    return round(sum(item.adherence for item in checkins) / len(checkins))


class RemindersView(APIView):
    """Recordatorios vigentes del paciente, mostrados en su portal."""

    def get(self, request):
        if request.user.role != User.Roles.PATIENT:
            raise PermissionDenied('Los recordatorios son del paciente.')
        plan = active_plan(request.user)
        return Response(pending_for_plan(plan) if plan else [])


class AssistantView(APIView):
    """Conversación diaria con el asistente (solo pacientes)."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'assistant'

    def _require_patient(self, request):
        if request.user.role != User.Roles.PATIENT:
            raise PermissionDenied('El asistente está reservado para el seguimiento del paciente.')

    def get(self, request):
        self._require_patient(request)
        conversation = assistant.current_conversation(request.user)
        return Response({
            'conversation': assistant.conversation_payload(conversation) if conversation else None,
            'ai_enabled': ai_enabled(),
        })

    def _message(self, request):
        self._require_patient(request)
        data = request.data if isinstance(request.data, dict) else {}
        pain = data.get('pain_level')
        if pain not in (None, '') and not (isinstance(pain, int) and not isinstance(pain, bool)):
            raise ValidationError({'pain_level': 'El nivel de dolor debe ser un número entero de 0 a 10.'})
        comparison = data.get('comparison') or None
        if comparison not in (None, 'lower', 'same', 'higher'):
            raise ValidationError({'comparison': 'Indica si estás mejor, igual o peor.'})
        chosen = data.get('appointment_date') or None
        if chosen is not None:
            try:
                chosen = date.fromisoformat(str(chosen))
            except ValueError as error:
                raise ValidationError({'appointment_date': 'Usa una fecha válida.'}) from error
        return str(data.get('text', '')), pain if pain != '' else None, comparison, chosen

    def post(self, request):
        text, pain, comparison, chosen = self._message(request)
        result = assistant.handle_message(request.user, text, pain, comparison, appointment_date=chosen)
        return Response(result, status=status.HTTP_201_CREATED)


def sse(event, data):
    return f'event: {event}\ndata: {json.dumps(data, cls=JSONEncoder, ensure_ascii=False)}\n\n'


class AssistantStreamView(AssistantView):
    """El mismo turno del asistente, transmitido: el texto aparece mientras el modelo lo escribe.

    Responde con Server-Sent Events: varios «delta» con el texto acumulado y un «done» final con el
    mismo resultado que devuelve POST /assistant/messages/.
    """

    http_method_names = ['post', 'options']

    def post(self, request):
        text, pain, comparison, chosen = self._message(request)
        events = assistant.message_events(request.user, text, pain, comparison, stream=True, appointment_date=chosen)
        # El primer evento se pide aquí: un mensaje no válido responde 400 normal, no un flujo roto.
        first = next(events)

        def body():
            try:
                kind, value = first
                while True:
                    yield sse(kind, {'text': value} if kind == 'delta' else value)
                    kind, value = next(events)
            except StopIteration:
                return
            except Exception:
                logger.exception('Fallo al transmitir la respuesta del asistente')
                yield sse('error', {'detail': 'No pude procesar tu mensaje. Inténtalo nuevamente.'})

        response = StreamingHttpResponse(body(), content_type='text/event-stream; charset=utf-8', status=200)
        response['Cache-Control'] = 'no-cache'
        # Sin compresión ni búfer intermedio: cada fragmento debe llegar al navegador en cuanto se produce.
        response['Content-Encoding'] = 'identity'
        response['X-Accel-Buffering'] = 'no'
        return response


class AppointmentRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """Citas reservadas en el chat.

    El paciente ve las suyas; el odontólogo, las de su agenda y las de sus pacientes. Nadie las
    confirma a mano: se reservan en un turno libre. Ambos pueden cancelarlas (POST /{id}/cancel/).
    ?status=booked|cancelled|attended, ?upcoming=true (solo las que aún no ocurren).
    """

    serializer_class = AppointmentRequestSerializer

    def get_queryset(self):
        user = self.request.user
        queryset = AppointmentRequest.objects.select_related('patient', 'doctor', 'treatment_plan', 'handled_by')
        if user.role == User.Roles.PATIENT:
            queryset = queryset.filter(patient=user)
        elif user.role == User.Roles.DOCTOR:
            queryset = queryset.filter(models.Q(doctor=user) | models.Q(patient__in=patients_of(user))).distinct()
        else:
            return queryset.none()
        state = self.request.query_params.get('status')
        if state:
            if state not in AppointmentRequest.Status.values:
                raise ValidationError({'status': 'Estado no válido.'})
            queryset = queryset.filter(status=state)
        if self.request.query_params.get('upcoming') == 'true':
            return queryset.filter(starts_at__gte=timezone.now()).order_by('starts_at', 'id')
        return queryset

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        item = self.get_object()
        if item.status != AppointmentRequest.Status.BOOKED:
            raise ValidationError({'detail': 'Esta cita ya no está reservada.'})
        if item.starts_at and item.starts_at < timezone.now():
            raise ValidationError({'detail': 'La cita ya pasó; no se puede cancelar.'})
        serializer = CancelAppointmentSerializer(data=request.data if isinstance(request.data, dict) else {})
        serializer.is_valid(raise_exception=True)
        cancel_appointment(item, request.user, serializer.validated_data['reason'])
        record_audit(request.user, f'Canceló la cita {item.pk}', 'Agenda')
        return Response(AppointmentRequestSerializer(item).data)


class VocabularyView(APIView):
    """Categorías que reconoce el PLN: el catálogo de protocolos solo admite estas."""

    def get(self, request):
        if request.user.role not in (User.Roles.ADMIN, User.Roles.DOCTOR):
            raise PermissionDenied('Solo el equipo clínico consulta el vocabulario.')
        return Response({'symptoms': sorted(SYMPTOMS), 'care': sorted(CARE)})


class AIStatusView(APIView):
    def get(self, request):
        return Response({'enabled': ai_enabled(), 'model': settings.AI_MODEL if ai_enabled() else None})


class AIMetricsView(APIView):
    """Uso de la IA en los últimos 30 días: evidencia de latencia, costo en tokens y fiabilidad."""

    def get(self, request):
        if request.user.role != User.Roles.ADMIN:
            raise PermissionDenied('Solo el administrador puede ver las métricas de la IA.')
        since = timezone.now() - timedelta(days=30)
        rows = (
            AIInteraction.objects.filter(created_at__gte=since).values('feature')
            .annotate(
                total=models.Count('id'),
                fallbacks=models.Count('id', filter=models.Q(fallback_used=True)),
                avg_latency=models.Avg('latency_ms', filter=models.Q(fallback_used=False)),
                input_tokens=models.Sum('input_tokens'),
                output_tokens=models.Sum('output_tokens'),
                cache_read_tokens=models.Sum('cache_read_tokens'),
            )
            .order_by('feature')
        )
        labels = dict(AIInteraction.Feature.choices)
        features = [
            {
                'feature': row['feature'],
                'label': labels.get(row['feature'], row['feature']),
                'total': row['total'],
                'llm': row['total'] - row['fallbacks'],
                'fallback_rate': round(100 * row['fallbacks'] / row['total']) if row['total'] else 0,
                'avg_latency_ms': round(row['avg_latency']) if row['avg_latency'] is not None else None,
                'input_tokens': row['input_tokens'] or 0,
                'output_tokens': row['output_tokens'] or 0,
                'cache_read_tokens': row['cache_read_tokens'] or 0,
            }
            for row in rows
        ]
        errors = list(
            AIInteraction.objects.filter(created_at__gte=since).exclude(error='').values('error')
            .annotate(total=models.Count('id')).order_by('-total')[:5]
        )
        return Response({
            'enabled': ai_enabled(),
            'model': settings.AI_MODEL,
            'days': 30,
            'features': features,
            'errors': errors,
        })

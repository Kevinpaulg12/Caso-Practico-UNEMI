"""Submódulo «Mi horario» del odontólogo: horario de atención, días no disponibles y agenda de citas."""
from datetime import date, datetime, timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User, patients_of

from .appointments import block_time, free_slots, schedule_of
from .audit import record_audit
from .models import AppointmentRequest, DoctorSchedule, PatientReport, TimeOff, WorkingHours
from .serializers_followup import AppointmentRequestSerializer, DoctorScheduleSerializer, TimeOffSerializer

MAX_AGENDA_DAYS = 62


def require_doctor(user):
    if user.role != User.Roles.DOCTOR:
        raise PermissionDenied('Solo el odontólogo administra su horario.')


def schedule_payload(doctor):
    schedule = DoctorSchedule.objects.filter(doctor=doctor).first() or DoctorSchedule(doctor=doctor)
    return {
        'slot_minutes': schedule.slot_minutes,
        'max_days_ahead': schedule.max_days_ahead,
        'hours': [
            {'weekday': item.weekday, 'start': item.start.strftime('%H:%M'), 'end': item.end.strftime('%H:%M')}
            for item in doctor.working_hours.all()
        ],
        'published': schedule_of(doctor) is not None,
        'updated_at': schedule.updated_at,
    }


class DoctorScheduleView(APIView):
    """GET: horario del odontólogo. PUT: lo reemplaza completo (duración del turno y franjas semanales)."""

    def get(self, request):
        require_doctor(request.user)
        return Response(schedule_payload(request.user))

    @transaction.atomic
    def put(self, request):
        require_doctor(request.user)
        serializer = DoctorScheduleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        DoctorSchedule.objects.update_or_create(
            doctor=request.user,
            defaults={'slot_minutes': data['slot_minutes'], 'max_days_ahead': data['max_days_ahead']},
        )
        WorkingHours.objects.filter(doctor=request.user).delete()
        WorkingHours.objects.bulk_create([WorkingHours(doctor=request.user, **item) for item in data['hours']])
        record_audit(request.user, 'Actualizó su horario de atención', 'Agenda')
        # Las citas ya reservadas se respetan aunque queden fuera del nuevo horario.
        return Response(schedule_payload(request.user))


class TimeOffViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Días u horas en que el odontólogo no atiende. Al crear uno se cancelan las citas que choquen."""

    serializer_class = TimeOffSerializer
    pagination_class = None

    def get_queryset(self):
        require_doctor(self.request.user)
        return TimeOff.objects.filter(doctor=self.request.user, date__gte=timezone.localdate())

    def create(self, request, *args, **kwargs):
        require_doctor(request.user)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        block, cancelled = block_time(
            request.user, data['date'], data.get('start'), data.get('end'), data.get('reason', ''),
        )
        record_audit(request.user, f'Bloqueó su agenda el {block.date:%d/%m/%Y} ({cancelled} citas canceladas)', 'Agenda')
        return Response({**TimeOffSerializer(block).data, 'cancelled_appointments': cancelled}, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        record_audit(self.request.user, f'Liberó su agenda del {instance.date:%d/%m/%Y}', 'Agenda')
        instance.delete()


class TimeOffPreviewView(APIView):
    """Cuántas citas cancelaría un bloqueo, para avisar antes de confirmarlo."""

    def get(self, request):
        require_doctor(request.user)
        serializer = TimeOffSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        block = TimeOff(doctor=request.user, date=data['date'], start=data.get('start'), end=data.get('end'))
        booked = AppointmentRequest.objects.filter(
            doctor=request.user, status=AppointmentRequest.Status.BOOKED, starts_at__date=block.date,
        )
        if not block.all_day:
            start = timezone.make_aware(datetime.combine(block.date, block.start))
            end = timezone.make_aware(datetime.combine(block.date, block.end))
            booked = [item for item in booked if item.starts_at < end and start < item.ends_at]
        return Response({'appointments': AppointmentRequestSerializer(booked, many=True).data})


class AgendaView(APIView):
    """Citas reservadas del odontólogo entre ?from= y ?to= (por defecto, los próximos 7 días)."""

    def get(self, request):
        require_doctor(request.user)
        today = timezone.localdate()
        try:
            first = date.fromisoformat(request.query_params.get('from') or today.isoformat())
            last = date.fromisoformat(request.query_params.get('to') or (first + timedelta(days=6)).isoformat())
        except ValueError as error:
            raise ValidationError({'detail': 'Usa fechas con el formato AAAA-MM-DD.'}) from error
        if last < first or (last - first).days > MAX_AGENDA_DAYS:
            raise ValidationError({'detail': f'Elige un rango de hasta {MAX_AGENDA_DAYS} días.'})
        appointments = (
            AppointmentRequest.objects.select_related('patient', 'doctor', 'treatment_plan')
            .filter(doctor=request.user, starts_at__date__gte=first, starts_at__date__lte=last)
            .exclude(status=AppointmentRequest.Status.CANCELLED)
            .order_by('starts_at')
        )
        blocks = TimeOff.objects.filter(doctor=request.user, date__gte=first, date__lte=last)
        free = {}
        schedule = schedule_of(request.user)
        day = max(first, today)
        while schedule and day <= last:
            free[day.isoformat()] = len(free_slots(request.user, day, schedule))
            day += timedelta(days=1)
        return Response({
            'from': first, 'to': last,
            'appointments': AppointmentRequestSerializer(appointments, many=True).data,
            'time_off': TimeOffSerializer(blocks, many=True).data,
            'free_slots_per_day': free,
        })


ALERT_HOURS = 72


class DoctorNotificationsView(APIView):
    """Campana del odontólogo: sus próximas citas y las alertas rojas recientes de sus pacientes."""

    def get(self, request):
        require_doctor(request.user)
        now = timezone.now()
        appointments = (
            AppointmentRequest.objects.select_related('patient', 'doctor', 'treatment_plan')
            .filter(doctor=request.user, status=AppointmentRequest.Status.BOOKED, starts_at__gte=now)
            .order_by('starts_at')[:15]
        )
        alerts = (
            PatientReport.objects.select_related('patient')
            .filter(patient__in=patients_of(request.user), risk_level='Alto',
                    created_at__gte=now - timedelta(hours=ALERT_HOURS), treatment_plan__is_active=True)
            .order_by('-created_at')[:15]
        )
        return Response({
            'appointments': [
                {**item, 'patient_id': item['patient']}
                for item in AppointmentRequestSerializer(appointments, many=True).data
            ],
            'alerts': [
                {
                    'id': report.pk,
                    'patient_id': report.patient_id,
                    'patient_name': report.patient.get_full_name() or report.patient.username,
                    'treatment_plan': report.treatment_plan_id,
                    'pain_level': report.pain_level,
                    'reasons': (report.alert_reasons or [])[:3],
                    'created_at': report.created_at,
                }
                for report in alerts
            ],
        })

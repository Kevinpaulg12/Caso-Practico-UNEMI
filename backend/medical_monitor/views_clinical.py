from collections import Counter, defaultdict
from datetime import timedelta

from django.db import models, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, permissions, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User, patients_of

from .audit import record_audit
from .clinical_history import build_clinical_history
from .doctor_report import treatment_report
from .models import (
    AlertSettings,
    AuditEvent,
    ClinicalProcedure,
    InstructionPreset,
    MedicationGuide,
    PatientReport,
    Prescription,
    TreatmentChange,
    TreatmentPlan,
)
from .serializers_clinical import (
    AlertSettingsSerializer,
    AuditEventSerializer,
    ClinicalProcedureSerializer,
    InstructionPresetSerializer,
    MedicationGuideSerializer,
)
from .services import detect_symptoms


class IsAdminRole(permissions.BasePermission):
    message = 'Solo el administrador puede realizar esta acción.'

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == User.Roles.ADMIN


class IsStaffRole(permissions.BasePermission):
    message = 'Solo el equipo clínico puede realizar esta acción.'

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in (User.Roles.ADMIN, User.Roles.DOCTOR)


class IsDoctorRole(permissions.BasePermission):
    message = 'Solo el odontólogo puede realizar esta acción.'

    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == User.Roles.DOCTOR


def base_permissions(extra):
    return [permission() for permission in (*_defaults(), extra)]


def _defaults():
    from rest_framework.settings import api_settings
    return api_settings.DEFAULT_PERMISSION_CLASSES


class AlertSettingsView(APIView):
    def get_permissions(self):
        return base_permissions(IsAdminRole)

    def get(self, request):
        return Response(AlertSettingsSerializer(AlertSettings.load()).data)

    def patch(self, request):
        serializer = AlertSettingsSerializer(AlertSettings.load(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        record_audit(request.user, 'Modificó los umbrales de alerta', 'Reglas')
        return Response(serializer.data)


class AuditEventViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditEventSerializer

    def get_permissions(self):
        return base_permissions(IsAdminRole)

    def get_queryset(self):
        queryset = AuditEvent.objects.order_by('-created_at', '-id')
        search = self.request.query_params.get('search', '').strip()
        if search:
            queryset = queryset.filter(
                models.Q(actor_label__icontains=search) | models.Q(action__icontains=search)
            )
        days = self.request.query_params.get('days', '')
        if days:
            if not days.isdigit():
                raise ValidationError({'days': 'Indica un número de días válido.'})
            queryset = queryset.filter(created_at__gte=timezone.now() - timedelta(days=int(days)))
        return queryset


class ClinicalProcedureViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ClinicalProcedureSerializer

    def get_permissions(self):
        # El odontólogo consulta el catálogo al registrar una consulta; solo el administrador lo edita.
        if self.action in ('list', 'retrieve'):
            return base_permissions(IsStaffRole)
        return base_permissions(IsAdminRole)

    def get_queryset(self):
        queryset = ClinicalProcedure.objects.order_by('code')
        if self.request.user.role != User.Roles.ADMIN:
            queryset = queryset.filter(is_active=True)
        return queryset

    def perform_create(self, serializer):
        serializer.save()
        record_audit(self.request.user, f'Creó el protocolo {serializer.instance.code}', 'Catálogo')

    def perform_update(self, serializer):
        serializer.save()
        record_audit(self.request.user, f'Modificó el protocolo {serializer.instance.code}', 'Catálogo')


class MedicationGuideViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MedicationGuideSerializer
    queryset = MedicationGuide.objects.order_by('name')

    def get_permissions(self):
        return base_permissions(IsAdminRole)


class InstructionPresetViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Frases propias del odontólogo para indicaciones, dieta y efectos: cada uno ve solo las suyas."""

    serializer_class = InstructionPresetSerializer
    pagination_class = None

    def get_permissions(self):
        return base_permissions(IsDoctorRole)

    def get_queryset(self):
        queryset = InstructionPreset.objects.filter(doctor=self.request.user)
        field = self.request.query_params.get('field')
        return queryset.filter(field=field) if field else queryset

    def perform_create(self, serializer):
        serializer.save(doctor=self.request.user)


def _scoped_doctor(request):
    if request.user.role != User.Roles.DOCTOR:
        raise PermissionDenied('Solo el odontólogo puede consultar esta información.')
    return request.user


class ReportsSummaryView(APIView):
    def get(self, request):
        doctor = _scoped_doctor(request)
        days = request.query_params.get('days', '30')
        if not days.isdigit() or not 1 <= int(days) <= 3650:
            raise ValidationError({'days': 'Indica un número de días válido.'})
        since = timezone.now() - timedelta(days=int(days))
        reports = list(
            PatientReport.objects
            .filter(patient__in=patients_of(doctor), created_at__gte=since)
            .order_by('created_at', 'id')
            .values('patient_id', 'pain_level', 'risk_level', 'message', 'created_at', 'postoperative_day')
        )

        by_patient = defaultdict(list)
        symptoms = Counter()
        for report in reports:
            by_patient[report['patient_id']].append(report)
            symptoms.update(detect_symptoms(report['message']))

        pain_by_day = defaultdict(list)
        followups = []
        for items in by_patient.values():
            first = timezone.localtime(items[0]['created_at']).date()
            last = timezone.localtime(items[-1]['created_at']).date()
            followups.append((last - first).days + 1)
            for item in items:
                # Día postoperatorio (0 = cirugía); los reportes antiguos usan los días desde el primero.
                day = item['postoperative_day']
                if day is None:
                    day = (timezone.localtime(item['created_at']).date() - first).days
                # En el seguimiento por conversación el paciente puede no haber dicho su dolor.
                if day <= 14 and item['pain_level'] is not None:
                    pain_by_day[day].append(item['pain_level'])

        latest_risk = Counter(items[-1]['risk_level'] for items in by_patient.values())
        counts = Counter(report['risk_level'] for report in reports)
        return Response({
            'days': int(days),
            'patients_monitored': len(by_patient),
            'reports_total': len(reports),
            'alerts_medium': counts['Medio'],
            'alerts_high': counts['Alto'],
            'average_followup_days': round(sum(followups) / len(followups), 1) if followups else None,
            'risk_distribution': {level: latest_risk[level] for level in ('Bajo', 'Medio', 'Alto')},
            'pain_by_day': [
                {'day': day, 'average': round(sum(values) / len(values), 1), 'reports': len(values)}
                for day, values in sorted(pain_by_day.items())
            ],
            'top_symptoms': [{'label': label, 'count': count} for label, count in symptoms.most_common(5)],
            'high_pain_threshold': AlertSettings.load().high_pain,
            # Lo que hizo el odontólogo en el periodo: tratamientos, controles, recetas y altas.
            'activity': treatment_report(doctor, since),
        })


class DischargeListView(APIView):
    def get(self, request):
        doctor = _scoped_doctor(request)
        search = request.query_params.get('search', '').strip()
        plans = (
            TreatmentPlan.objects
            .filter(patient__in=patients_of(doctor), is_active=False)
            .select_related('patient', 'patient__profile')
            .order_by('-updated_at')
        )
        if search:
            plans = plans.filter(
                models.Q(patient__first_name__icontains=search)
                | models.Q(patient__last_name__icontains=search)
                | models.Q(procedure__icontains=search)
            )
        alerts = dict(
            PatientReport.objects
            .filter(patient__in=patients_of(doctor), risk_level='Alto')
            .order_by().values_list('patient_id').annotate(total=models.Count('id'))
        )
        results = []
        for plan in plans[:100]:
            start = plan.start_date or timezone.localtime(plan.created_at).date()
            end = timezone.localtime(plan.updated_at).date()
            results.append({
                'id': plan.id,
                'patient_id': plan.patient_id,
                'patient_name': plan.patient.get_full_name() or plan.patient.username,
                'procedure': plan.procedure or plan.title,
                'start_date': start,
                'discharged_at': end,
                'followup_days': (end - start).days + 1,
                'high_alerts': alerts.get(plan.patient_id, 0),
            })
        return Response(results)


class PatientDischargeView(APIView):
    """Alta médica: cierra TODOS los tratamientos y recetas vigentes del paciente, no solo el primero."""

    @transaction.atomic
    def post(self, request, patient_id):
        doctor = _scoped_doctor(request)
        patient = get_object_or_404(patients_of(doctor), pk=patient_id)
        now = timezone.now()
        # Se bloquean las filas: una consulta registrada a la vez no puede quedar abierta tras el alta.
        plan_ids = list(
            TreatmentPlan.objects.select_for_update()
            .filter(patient=patient, is_active=True).values_list('pk', flat=True)
        )
        prescription_ids = list(
            Prescription.objects.select_for_update()
            .filter(patient=patient, is_active=True).values_list('pk', flat=True)
        )
        if not plan_ids and not prescription_ids:
            raise ValidationError({'detail': 'Este paciente no tiene tratamientos activos.'})
        TreatmentPlan.objects.filter(pk__in=plan_ids).update(is_active=False, updated_at=now)
        Prescription.objects.filter(pk__in=prescription_ids).update(is_active=False, updated_at=now)
        author = doctor.get_full_name() or doctor.username
        TreatmentChange.objects.bulk_create([
            TreatmentChange(
                treatment_plan_id=plan_id, author=doctor, kind=TreatmentChange.Kind.DISCHARGE,
                summary=f'Alta médica registrada por {author}.',
            )
            for plan_id in plan_ids
        ])
        record_audit(doctor, f'Dio de alta a {patient.username} ({len(plan_ids)} tratamientos)', 'Altas')
        return Response({'plans_closed': len(plan_ids), 'prescriptions_closed': len(prescription_ids)})


class ClinicalHistoryView(APIView):
    """Historia clínica completa del paciente para cualquier odontólogo de la clínica (con auditoría)."""

    def get(self, request, patient_id):
        if request.user.role != User.Roles.DOCTOR:
            raise PermissionDenied('Solo los odontólogos de la clínica consultan la historia clínica.')
        patient = get_object_or_404(User.objects.select_related('profile__primary_doctor'), pk=patient_id, role=User.Roles.PATIENT)
        record_audit(request.user, f'Consultó la historia clínica de {patient.username}', 'Historia clínica')
        return Response(build_clinical_history(patient))

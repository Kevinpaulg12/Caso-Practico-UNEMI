from django.contrib.auth import get_user_model
from django.db.models import Prefetch
from django.db import models
from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.views import APIView

from medical_monitor.audit import record_audit
from medical_monitor.models import PatientReport, TreatmentPlan

from .models import UserProfile, patients_of
from .serializers import UserProfileSerializer
from .serializers_me import CurrentUserSerializer
from .serializers_patients import PatientCreateSerializer
from .serializers_patients import PatientSearchSerializer

User = get_user_model()
SEARCH_LIMIT = 25
RISK_ORDER = {'Alto': 0, 'Medio': 1, 'Bajo': 2}


class UserProfileViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = UserProfileSerializer

    def get_queryset(self):
        profile, _ = UserProfile.objects.get_or_create(user=self.request.user)
        return UserProfile.objects.filter(pk=profile.pk).order_by('pk')


class CurrentUserViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    allow_pending_terms = True
    allow_pending_password_change = True
    serializer_class = CurrentUserSerializer

    def list(self, request, *args, **kwargs):
        return Response(self.get_serializer(request.user).data)


class PatientCreateView(APIView):
    def get(self, request):
        if request.user.role != request.user.Roles.DOCTOR:
            raise PermissionDenied('Solo el equipo médico puede buscar pacientes.')
        search = request.query_params.get('search', '').strip()
        # El panel muestra solo a quienes siguen en tratamiento; los dados de alta están en Historial.
        # La búsqueda de la consulta médica encuentra a todos, para volver a atender a un paciente.
        only_active = not search or request.query_params.get('active', '').lower() == 'true'
        treated = patients_of(request.user)
        if search:
            # Se busca libremente solo entre los propios pacientes. La cédula exacta permite
            # reutilizar la ficha de otro médico sin duplicarla.
            treated_ids = treated.values('pk')
            # «ana ruiz» encuentra a Ana María Ruiz: cada palabra debe aparecer en algún campo.
            matches_every_word = models.Q(pk__in=treated_ids)
            for word in search.split()[:6]:
                matches_every_word &= (
                    models.Q(first_name__icontains=word)
                    | models.Q(last_name__icontains=word)
                    | models.Q(username__icontains=word)
                    | models.Q(profile__national_id__icontains=word)
                )
            patients = User.objects.filter(role=User.Roles.PATIENT).filter(
                matches_every_word | models.Q(profile__national_id=search)
            )
        else:
            patients = treated
        if only_active:
            patients = patients.filter(treatment_plans__is_active=True).distinct()
        patients = list(patients.select_related('profile').prefetch_related(
            Prefetch('treatment_plans', TreatmentPlan.objects.select_related('clinical_procedure')),
            Prefetch('postoperative_reports', PatientReport.objects.order_by('-created_at', '-id')),
        ))
        serializer_context = {'treated_ids': set(treated.values_list('pk', flat=True))}
        data = PatientSearchSerializer(patients, many=True, context=serializer_context).data
        # Las alertas siempre encabezan la lista; solo la búsqueda se recorta.
        data = sorted(
            data,
            key=lambda item: (RISK_ORDER.get(item['risk_level'], 3), item['full_name'].casefold(), item['id']),
        )
        return Response(data[:SEARCH_LIMIT] if search else data)

    def post(self, request):
        if request.user.role != request.user.Roles.DOCTOR:
            raise PermissionDenied('Solo el equipo médico puede registrar pacientes.')
        serializer = PatientCreateSerializer(
            data=request.data,
            context={'doctor': request.user},
        )
        serializer.is_valid(raise_exception=True)
        patient, temporary_password = serializer.save()
        record_audit(request.user, f'Creó la ficha de {patient.username}', 'Pacientes')
        return Response(
            {
                'id': patient.id,
                'username': patient.username,
                'full_name': patient.get_full_name(),
                'age': patient.age,
                'temporary_password': temporary_password,
                'message': 'Paciente registrado correctamente.',
            },
            status=status.HTTP_201_CREATED,
        )

from django.contrib.auth import get_user_model
from django.db.models import Prefetch
from django.db import models
from rest_framework import mixins, viewsets
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.views import APIView

from medical_monitor.audit import record_audit
from medical_monitor.models import PatientReport, TreatmentPlan

from .models import UserProfile, patients_of
from .serializers import UserProfileSerializer
from .serializers_me import CurrentUserSerializer
from .credentials import credentials_status, mask_email, resend_credentials, send_credentials
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
        return UserProfile.objects.filter(pk=profile.pk).select_related('primary_doctor__profile').order_by('pk')


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
        # Las credenciales viajan solo por correo institucional; la respuesta nunca incluye la contraseña.
        send_credentials(patient, temporary_password, request.user)
        record_audit(request.user, f'Creó la ficha de {patient.username} y envió sus credenciales por correo', 'Pacientes')
        return Response(
            {
                'id': patient.id,
                'username': patient.username,
                'full_name': patient.get_full_name(),
                'age': patient.age,
                'credentials': {'email': mask_email(patient.email), 'sent_at': None, 'error': ''},
                'message': 'Paciente registrado correctamente.',
            },
            status=status.HTTP_201_CREATED,
        )


class PatientCredentialsView(APIView):
    """GET: estado del envío de las credenciales. POST: genera otra contraseña temporal y la reenvía."""

    def _patient(self, request, patient_id):
        if request.user.role != request.user.Roles.DOCTOR:
            raise PermissionDenied('Solo el equipo médico gestiona las credenciales de los pacientes.')
        patient = patients_of(request.user).filter(pk=patient_id).select_related('profile').first()
        if patient is None:
            raise NotFound('Este paciente no existe o no es tuyo.')
        return patient

    def get(self, request, patient_id):
        return Response(credentials_status(self._patient(request, patient_id)))

    def post(self, request, patient_id):
        patient = self._patient(request, patient_id)
        if not patient.email:
            raise ValidationError({'email': 'El paciente no tiene correo registrado.'})
        resend_credentials(patient, request.user)
        record_audit(request.user, f'Reenvió las credenciales de {patient.username}', 'Pacientes')
        return Response(credentials_status(patient), status=status.HTTP_202_ACCEPTED)

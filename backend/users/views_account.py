from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from medical_monitor.audit import record_audit

from .authentication import ensure_not_idle, touch
from .models import TERMS_VERSION, User, UserProfile
from .serializers_account import AccountSerializer, ChangePasswordSerializer


class LoginSerializer(TokenObtainPairSerializer):
    default_error_messages = {
        'no_active_account': 'Credenciales inválidas. Verifica tu usuario y contraseña.',
    }

    def validate(self, attrs):
        # El formulario admite la cédula además del nombre de usuario.
        identifier = attrs[self.username_field]
        if identifier.isdigit() and not User.objects.filter(username=identifier).exists():
            profile = UserProfile.objects.select_related('user').filter(national_id=identifier).first()
            if profile:
                attrs = {**attrs, self.username_field: profile.user.username}
        data = super().validate(attrs)
        touch(self.user, force=True)
        return data


class IdleAwareRefreshSerializer(TokenRefreshSerializer):
    """No renueva el acceso de un usuario que superó el tiempo de inactividad."""

    def validate(self, attrs):
        user_id = RefreshToken(attrs['refresh']).payload.get(jwt_settings.USER_ID_CLAIM)
        user = User.objects.filter(pk=user_id).first()
        if user:
            ensure_not_idle(user)
        return super().validate(attrs)


class RefreshView(TokenRefreshView):
    serializer_class = IdleAwareRefreshSerializer


class SessionPingView(APIView):
    """La interfaz lo llama mientras el usuario interactúa sin hacer otras peticiones."""
    allow_pending_terms = True
    allow_pending_password_change = True

    def post(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request, *args, **kwargs):
        try:
            response = super().post(request, *args, **kwargs)
        except AuthenticationFailed:
            label = str(request.data.get('username', ''))[:80] or 'Anónimo'
            record_audit(None, 'Intento de autenticación denegado', 'Seguridad', label=label)
            raise
        username = request.data.get('username')
        record_audit(None, 'Inició sesión', 'Seguridad', label=str(username)[:80])
        return response


class AccountView(APIView):
    allow_pending_password_change = True

    def get(self, request):
        UserProfile.objects.get_or_create(user=request.user)
        return Response(AccountSerializer(request.user).data)

    def patch(self, request):
        UserProfile.objects.get_or_create(user=request.user)
        serializer = AccountSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class TermsConsentView(APIView):
    """Consentimiento del paciente: Términos y Condiciones y uso de sus datos de salud.

    Se acepta una sola vez y queda registrada la fecha y la versión. Rechazarlos también se audita;
    la interfaz cierra la sesión y el paciente no puede usar el portal hasta aceptarlos.
    """
    allow_pending_terms = True
    allow_pending_password_change = True

    def get(self, request):
        user = request.user
        return Response({
            'version': TERMS_VERSION,
            'must_accept_terms': user.must_accept_terms,
            'accepted_at': user.terms_accepted_at,
            'accepted_version': user.terms_version,
        })

    def post(self, request):
        accepted = request.data.get('accepted')
        if not isinstance(accepted, bool):
            raise ValidationError({'accepted': 'Indica si aceptas o no los términos.'})
        if request.data.get('version') != TERMS_VERSION:
            raise ValidationError({'version': 'Los términos cambiaron. Vuelve a leerlos antes de aceptar.'})
        user = request.user
        if not accepted:
            record_audit(user, f'Rechazó los términos y el uso de datos ({TERMS_VERSION})', 'Consentimiento')
            return Response({'must_accept_terms': user.must_accept_terms})
        user.must_accept_terms = False
        user.terms_accepted_at = timezone.now()
        user.terms_version = TERMS_VERSION
        user.save(update_fields=['must_accept_terms', 'terms_accepted_at', 'terms_version'])
        record_audit(user, f'Aceptó los términos y el uso de datos ({TERMS_VERSION})', 'Consentimiento')
        return Response({
            'must_accept_terms': False,
            'accepted_at': user.terms_accepted_at,
            'must_change_password': user.must_change_password,
        })


class ChangePasswordView(APIView):
    allow_pending_password_change = True

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data['new_password'])
        request.user.must_change_password = False
        request.user.save(update_fields=['password', 'must_change_password'])
        record_audit(request.user, 'Cambió su contraseña', 'Seguridad')
        return Response(
            {'message': 'Contraseña actualizada. Inicia sesión nuevamente en tus otros dispositivos.'},
            status=status.HTTP_200_OK,
        )

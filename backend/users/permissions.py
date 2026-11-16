from rest_framework.permissions import BasePermission


class TermsAccepted(BasePermission):
    """Bloquea la API hasta aceptar los términos y el uso de datos, salvo en las vistas que lo permiten.

    Va antes que el cambio de contraseña: el paciente primero consiente y luego crea su clave.
    """

    message = 'Debes aceptar los Términos y Condiciones y el uso de tus datos antes de continuar.'

    def has_permission(self, request, view):
        if getattr(view, 'allow_pending_terms', False):
            return True
        user = request.user
        return not (user and user.is_authenticated and user.must_accept_terms)


class PasswordChangeCompleted(BasePermission):
    """Bloquea la API hasta cambiar la clave temporal, salvo en las vistas que lo permiten."""

    message = 'Debes cambiar tu contraseña temporal antes de continuar.'

    def has_permission(self, request, view):
        if getattr(view, 'allow_pending_password_change', False):
            return True
        user = request.user
        return not (user and user.is_authenticated and user.must_change_password)

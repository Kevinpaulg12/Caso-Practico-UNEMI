from .models import AuditEvent


def record_audit(user, action, module, label=None):
    """Registra un evento; user puede ser None (por ejemplo, un login fallido)."""
    authenticated = bool(user and user.is_authenticated)
    AuditEvent.objects.create(
        actor=user if authenticated else None,
        actor_label=(label or (user.get_full_name() or user.username if authenticated else 'Anónimo'))[:150],
        action=action[:200],
        module=module,
    )

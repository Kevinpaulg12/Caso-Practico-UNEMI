from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    """Característica opcional: recordatorios al paciente y correo al odontólogo ante una alerta roja.

    Se instala solo en las variantes con ENABLE_NOTIFICATIONS. Se conecta al núcleo escuchando su
    señal `high_risk_report`; el núcleo no importa nada de esta app.
    """

    name = 'notifications'
    verbose_name = 'Notificaciones'

    def ready(self):
        from medical_monitor.signals import high_risk_report

        from .alerts import email_doctor_on_high_risk

        high_risk_report.connect(email_doctor_on_high_risk, dispatch_uid='notifications.email_doctor')

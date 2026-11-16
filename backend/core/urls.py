from django.contrib import admin
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from medical_monitor.views import (
    ClinicalEvolutionSummaryViewSet,
    ConsultationCreateView,
    MedicationSearchView,
    PatientReportViewSet,
    PrescriptionViewSet,
    TreatmentPlanViewSet,
)
from medical_monitor.views_clinical import (
    AlertSettingsView,
    AuditEventViewSet,
    ClinicalProcedureViewSet,
    DischargeListView,
    MedicationGuideViewSet,
    PatientDischargeView,
    ReportsSummaryView,
)
from medical_monitor.views_followup import (
    AIMetricsView,
    AIStatusView,
    AssistantSubmitView,
    AssistantStreamView,
    AssistantView,
    CareCheckinView,
    RemindersView,
    VocabularyView,
)
from users.views import CurrentUserViewSet, PatientCreateView, UserProfileViewSet
from users.views_account import (
    AccountView,
    ChangePasswordView,
    LoginView,
    RefreshView,
    SessionPingView,
    TermsConsentView,
)
from users.views_admin import AdminUserViewSet

# El Router construye las URLs RESTful automáticamente (/api/prescriptions/)
router = DefaultRouter()
router.register(r'prescriptions', PrescriptionViewSet, basename='prescription')
router.register(r'patient-reports', PatientReportViewSet, basename='patient-report')
router.register(r'treatment-plans', TreatmentPlanViewSet, basename='treatment-plan')
router.register(r'clinical-evolution', ClinicalEvolutionSummaryViewSet, basename='clinical-evolution')
router.register(r'patient-profile', UserProfileViewSet, basename='patient-profile')
router.register(r'me', CurrentUserViewSet, basename='me')
router.register(r'admin/users', AdminUserViewSet, basename='admin-user')
router.register(r'audit-events', AuditEventViewSet, basename='audit-event')
router.register(r'procedures', ClinicalProcedureViewSet, basename='procedure')
router.register(r'medication-guides', MedicationGuideViewSet, basename='medication-guide')

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/token/', LoginView.as_view(), name='token_obtain_pair'),
    path('api/token/refresh/', RefreshView.as_view(), name='token_refresh'),
    path('api/patients/', PatientCreateView.as_view(), name='patient-create'),
    path('api/account/', AccountView.as_view(), name='account'),
    path('api/account/password/', ChangePasswordView.as_view(), name='account-password'),
    path('api/account/terms/', TermsConsentView.as_view(), name='account-terms'),
    path('api/medications/search/', MedicationSearchView.as_view(), name='medication-search'),
    path('api/consultations/', ConsultationCreateView.as_view(), name='consultation-create'),
    path('api/session/ping/', SessionPingView.as_view(), name='session-ping'),
    path('api/alert-settings/', AlertSettingsView.as_view(), name='alert-settings'),
    path('api/reports/summary/', ReportsSummaryView.as_view(), name='reports-summary'),
    path('api/discharges/', DischargeListView.as_view(), name='discharges'),
    path('api/patients/<int:patient_id>/discharge/', PatientDischargeView.as_view(), name='patient-discharge'),
    path('api/care-checkins/', CareCheckinView.as_view(), name='care-checkins'),
    path('api/reminders/', RemindersView.as_view(), name='reminders'),
    path('api/assistant/messages/', AssistantView.as_view(), name='assistant-messages'),
    path('api/assistant/messages/stream/', AssistantStreamView.as_view(), name='assistant-messages-stream'),
    path('api/assistant/submit/', AssistantSubmitView.as_view(), name='assistant-submit'),
    path('api/ai/status/', AIStatusView.as_view(), name='ai-status'),
    path('api/nlp/vocabulary/', VocabularyView.as_view(), name='nlp-vocabulary'),
    path('api/ai/metrics/', AIMetricsView.as_view(), name='ai-metrics'),
    path('api/', include(router.urls)), # Todas las rutas de la API tendrán el prefijo /api/
]
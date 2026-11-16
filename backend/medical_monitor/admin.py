from django.contrib import admin

from .models import (
    AlertSettings,
    ClinicalEvolutionSummary,
    ClinicalProcedure,
    MedicationGuide,
    PatientReport,
    Prescription,
    TreatmentPlan,
)

admin.site.register(AlertSettings)
admin.site.register(ClinicalProcedure)


@admin.register(Prescription)
class PrescriptionAdmin(admin.ModelAdmin):
    list_display = ('id', 'patient', 'doctor', 'is_active', 'nlp_severity', 'created_at')
    list_filter = ('is_active', 'nlp_severity', 'created_at')
    search_fields = ('patient__username', 'doctor__username', 'details')
    readonly_fields = ('created_at', 'updated_at')
    raw_id_fields = ('doctor', 'patient')


@admin.register(MedicationGuide)
class MedicationGuideAdmin(admin.ModelAdmin):
    list_display = ('name', 'source_note')
    search_fields = ('name',)


@admin.register(TreatmentPlan)
class TreatmentPlanAdmin(admin.ModelAdmin):
    list_display = ('title', 'patient', 'treatment_type', 'day_number', 'is_active')
    list_filter = ('treatment_type', 'is_active')


@admin.register(PatientReport)
class PatientReportAdmin(admin.ModelAdmin):
    list_display = ('patient', 'pain_level', 'postoperative_day', 'risk_level', 'doctor_notified', 'created_at')
    list_filter = ('comparison', 'nlp_severity', 'doctor_notified')


@admin.register(ClinicalEvolutionSummary)
class ClinicalEvolutionSummaryAdmin(admin.ModelAdmin):
    list_display = ('patient', 'day_label', 'eva_recorded', 'status_tag', 'created_at')

"""Resumen clínico de la evolución para el odontólogo.

Con el modelo de lenguaje se redacta a partir de datos estructurados y anonimizados; sin él, el
sistema compone un resumen estadístico. En ambos casos queda guardado en ClinicalSummary.
"""
import json
import threading
from collections import Counter
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, transaction
from django.utils import timezone
from pydantic import BaseModel, Field

from ..consultations import next_control_payload
from ..models import AIInteraction, ClinicalSummary
from ..treatments import display_clinical_data
from .anonymize import mask, plan_context
from .client import AIUnavailable, structured_call
from .prompts import summary_system

DISCLAIMER = 'Resumen de apoyo: no sustituye la valoración clínica del odontólogo.'
LEVEL_LABEL = {'Bajo': 'verde', 'Medio': 'amarillo', 'Alto': 'rojo'}


class SummaryOutput(BaseModel):
    resumen: str = Field(description='Dos a cuatro frases sobre cómo evoluciona el paciente.')
    cambios_recientes: list[str] = Field(default_factory=list)
    alertas: list[str] = Field(default_factory=list)
    adherencia: str = Field(description='Valoración breve del cumplimiento de los cuidados.')
    puntos_a_revisar: list[str] = Field(default_factory=list)


def plan_facts(plan):
    """Datos objetivos del tratamiento: alimentan tanto el resumen local como el del modelo."""
    reports = list(plan.reports.order_by('created_at', 'id'))
    since = timezone.localdate() - timedelta(days=7)
    checkins = list(plan.checkins.filter(date__gte=since))
    symptoms = Counter(
        entity['category'] for report in reports for entity in report.extracted_entities
        if entity.get('label') == 'SINTOMA' and not entity.get('negated')
    )
    return {
        'reports': reports,
        'adherence': round(sum(item.adherence for item in checkins) / len(checkins)) if checkins else None,
        'checkins': len(checkins),
        'next_control': next_control_payload(plan),
        'controls': list(plan.controls.order_by('date', 'id')),
        'symptoms': symptoms,
    }


def _masked(items, plan):
    """Los datos del tratamiento pueden incluir texto libre: también se enmascaran."""
    return {item['label']: mask(item['value'], plan.patient) for item in items}


def local_summary(plan, facts):
    reports = facts['reports']
    if not reports:
        overview = 'El paciente aún no ha enviado autorreportes en este tratamiento.'
        changes = []
    else:
        first, last = reports[0], reports[-1]
        trend = ('disminuye' if last.pain_level < first.pain_level
                 else 'aumenta' if last.pain_level > first.pain_level else 'se mantiene')
        overview = (
            f'{len(reports)} autorreportes desde el inicio. El dolor {trend} '
            f'(EVA {first.pain_level} → {last.pain_level}); último nivel {LEVEL_LABEL[last.risk_level]} '
            f'en el día {last.postoperative_day if last.postoperative_day is not None else "—"} de seguimiento.'
        )
        changes = [f'{category}: mencionado en {count} reporte(s)' for category, count in facts['symptoms'].most_common(4)]
    alerts = list(dict.fromkeys(
        reason for report in reports[-5:] if report.risk_level != 'Bajo' for reason in report.alert_reasons
    ))
    adherence = (
        f'{facts["adherence"]} % de los cuidados cumplidos en los últimos 7 días ({facts["checkins"]} registros).'
        if facts['adherence'] is not None else 'Sin registros de cuidados en los últimos 7 días.'
    )
    review = []
    if alerts:
        review.append('Valorar los motivos de alerta recientes.')
    if facts['adherence'] is not None and facts['adherence'] < 70:
        review.append('Reforzar las indicaciones de cuidado en casa.')
    control = facts['next_control']
    if control and control['overdue']:
        review.append(f'El control está atrasado {-control["days_left"]} día(s): el paciente no ha vuelto a consulta.')
    return SummaryOutput(resumen=overview, cambios_recientes=changes, alertas=alerts,
                         adherencia=adherence, puntos_a_revisar=review)


def llm_summary(plan, facts):
    reports = facts['reports'][-15:]
    payload = {
        'contexto_del_tratamiento': plan_context(plan),
        'autorreportes': [
            {
                'dia': report.postoperative_day,
                'eva': report.pain_level,
                'comparacion': report.comparison,
                'nivel_calculado_por_el_sistema': LEVEL_LABEL[report.risk_level],
                'motivos': report.alert_reasons,
                'texto_del_paciente': mask(report.message, plan.patient)[:400],
            }
            for report in reports
        ],
        'adherencia_ultimos_7_dias_pct': facts['adherence'],
        # Negativo = el paciente lleva esos días de atraso; nulo = no tiene un control pendiente.
        'proximo_control_en_dias': facts['next_control']['days_left'] if facts['next_control'] else None,
        'datos_del_tratamiento': _masked(display_clinical_data(plan.clinical_procedure, plan.clinical_data), plan),
        'controles_realizados': [
            {
                'dia_del_tratamiento': (visit.date - plan.surgery_date).days,
                'datos': _masked(display_clinical_data(plan.clinical_procedure, visit.clinical_data), plan),
                'notas': mask(visit.notes, plan.patient)[:300],
            }
            for visit in facts['controls'][-5:]
        ],
        'fases': [
            {'fase': phase.name, 'estado': phase.get_status_display()} for phase in plan.phases.all()
        ],
    }
    return structured_call(
        AIInteraction.Feature.SUMMARY,
        system=summary_system(),
        user=json.dumps(payload, ensure_ascii=False, default=str),
        output_format=SummaryOutput,
        effort='medium',
        max_tokens=2000,
    )


def generate_summary(plan):
    facts = plan_facts(plan)
    try:
        output, model = llm_summary(plan, facts)
        source = 'llm'
    except AIUnavailable:
        output, model, source = local_summary(plan, facts), '', 'local'
    content = {**output.model_dump(), 'aviso': DISCLAIMER}
    return ClinicalSummary.objects.create(
        treatment_plan=plan, content=content, source=source, model=model,
        report_ids=[report.id for report in facts['reports']],
    )


def summary_payload(summary):
    if summary is None:
        return None
    return {
        'id': summary.id,
        'content': summary.content,
        'source': summary.source,
        'model': summary.model,
        'created_at': summary.created_at,
        'reports_included': len(summary.report_ids),
    }


def refresh_summary_after_alert(plan):
    """Tras una alerta roja, prepara el resumen fuera de la respuesta al paciente (RNF02)."""
    if not settings.AI_SUMMARY_ON_ALERT:
        return

    def run():
        try:
            generate_summary(plan)
        finally:
            if settings.AI_IN_BACKGROUND:
                close_old_connections()

    def start():
        if settings.AI_IN_BACKGROUND:
            threading.Thread(target=run, daemon=True).start()
        else:
            run()

    transaction.on_commit(start)


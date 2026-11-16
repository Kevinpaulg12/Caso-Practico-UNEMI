"""Evalúa la extracción de síntomas sobre un conjunto etiquetado a mano (evidencia de la tesis).

Uso:
    python manage.py evaluate_nlp                      # solo el PLN local (spaCy + EntityRuler)
    python manage.py evaluate_nlp --llm                # compara además con el modelo de lenguaje
    python manage.py evaluate_nlp --output ruta.md     # dónde escribir el informe

La opción --llm envía las frases (anonimizadas, sin datos de pacientes reales) al proveedor de IA y
puede tener costo según tu plan: úsala solo con GEMINI_API_KEY configurada y de forma deliberada.
"""
import json
import statistics
import time
from collections import Counter
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.test.utils import override_settings
from django.utils import timezone
from pydantic import BaseModel

from medical_monitor.ai.assistant import ExtractedSymptom
from medical_monitor.ai.client import AIUnavailable, structured_call
from medical_monitor.models import AIInteraction
from medical_monitor.nlp import SYMPTOMS, affirmed_symptoms, extract_entities

DATASET = Path(__file__).resolve().parents[2] / 'data' / 'nlp_eval.jsonl'
DEFAULT_OUTPUT = Path(settings.BASE_DIR).parent / 'docs' / 'evidencias' / 'IA-evaluacion.md'
LLM_SYSTEM = (
    'Extrae los síntomas odontológicos que describe el paciente. Usa solo las categorías permitidas. '
    'Marca negado=true si el paciente dice que NO tiene el síntoma o que ya pasó. Categorías: '
    + ', '.join(sorted(SYMPTOMS)) + '.'
)


class LLMExtraction(BaseModel):
    sintomas: list[ExtractedSymptom]


def scores(results):
    """Precisión, exhaustividad y F1 por categoría y globales (micro) a partir de (esperado, obtenido)."""
    tp, fp, fn = Counter(), Counter(), Counter()
    for expected, predicted in results:
        for category in predicted & expected:
            tp[category] += 1
        for category in predicted - expected:
            fp[category] += 1
        for category in expected - predicted:
            fn[category] += 1

    def prf(t, p, n):
        precision = t / (t + p) if t + p else 1.0
        recall = t / (t + n) if t + n else 1.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        return precision, recall, f1

    per_category = {
        category: (*prf(tp[category], fp[category], fn[category]), tp[category] + fn[category])
        for category in sorted(set(tp) | set(fp) | set(fn))
    }
    micro = prf(sum(tp.values()), sum(fp.values()), sum(fn.values()))
    exact = sum(expected == predicted for expected, predicted in results) / len(results)
    negatives = [predicted for expected, predicted in results if not expected]
    clean_negatives = sum(not predicted for predicted in negatives) / len(negatives) if negatives else 1.0
    return {'per_category': per_category, 'micro': micro, 'exact': exact, 'negatives': clean_negatives,
            'n_negatives': len(negatives)}


class Command(BaseCommand):
    help = 'Mide precisión, exhaustividad y F1 de la extracción de síntomas (PLN local y, opcionalmente, LLM).'

    def add_arguments(self, parser):
        parser.add_argument('--llm', action='store_true', help='Comparar también con el modelo de lenguaje (tiene costo).')
        parser.add_argument('--output', default=str(DEFAULT_OUTPUT), help='Ruta del informe en Markdown.')

    def handle(self, *args, **options):
        rows = [json.loads(line) for line in DATASET.read_text(encoding='utf-8').splitlines() if line.strip()]
        unknown = {label for row in rows for label in row['symptoms']} - set(SYMPTOMS)
        if unknown:
            raise CommandError(f'Etiquetas fuera del vocabulario: {", ".join(sorted(unknown))}')

        local, latencies = [], []
        for row in rows:
            started = time.perf_counter()
            predicted = set(affirmed_symptoms(extract_entities(row['text'])))
            latencies.append((time.perf_counter() - started) * 1000)
            local.append((set(row['symptoms']), predicted))
        evaluations = {'PLN local (spaCy + EntityRuler)': scores(local)}
        errors = [(row, predicted) for row, (expected, predicted) in zip(rows, local) if expected != predicted]

        if options['llm']:
            llm, failures = [], 0
            with override_settings(AI_ENABLED=True):
                for row in rows:
                    try:
                        output, _ = structured_call(
                            AIInteraction.Feature.EXTRACTION, system=LLM_SYSTEM, user=row['text'],
                            output_format=LLMExtraction, effort='low', max_tokens=600,
                        )
                        predicted = {item.categoria for item in output.sintomas if not item.negado}
                    except AIUnavailable:
                        failures += 1
                        predicted = set()
                    llm.append((set(row['symptoms']), predicted))
            evaluations['Modelo de lenguaje (Gemini)'] = scores(llm)
            if failures:
                self.stdout.write(self.style.WARNING(f'El modelo no respondió en {failures} frases (cuentan como vacías).'))

        report = self.render(rows, evaluations, latencies, errors)
        output = Path(options['output'])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(report, encoding='utf-8')
        for name, result in evaluations.items():
            precision, recall, f1 = result['micro']
            self.stdout.write(f'{name}: precisión {precision:.1%} · exhaustividad {recall:.1%} · F1 {f1:.1%} · '
                              f'frases exactas {result["exact"]:.1%}')
        self.stdout.write(self.style.SUCCESS(f'Informe: {output}'))

    def render(self, rows, evaluations, latencies, errors):
        specialties = Counter(row['specialty'] for row in rows)
        lines = [
            '# Evaluación de la extracción de síntomas',
            '',
            f'Generado el {timezone.localtime():%d/%m/%Y %H:%M} con `python manage.py evaluate_nlp`.',
            '',
            f'Conjunto: {len(rows)} frases escritas como las escribiría un paciente, etiquetadas a mano sin mirar las reglas '
            f'del PLN ({", ".join(f"{name} {count}" for name, count in sorted(specialties.items()))}). '
            'Se cuentan solo los síntomas afirmados: «ya no me duele» no debe producir «Dolor».',
            '',
            '## Resultados globales',
            '',
            '| Método | Precisión | Exhaustividad | F1 | Frases exactas | Frases sin síntomas bien vacías |',
            '|---|---|---|---|---|---|',
        ]
        for name, result in evaluations.items():
            precision, recall, f1 = result['micro']
            lines.append(f'| {name} | {precision:.1%} | {recall:.1%} | {f1:.1%} | {result["exact"]:.1%} | '
                         f'{result["negatives"]:.1%} de {result["n_negatives"]} |')
        lines += [
            '',
            f'Latencia del PLN local por frase: mediana {statistics.median(latencies):.1f} ms, '
            f'máximo {max(latencies):.1f} ms (sin red ni servicios externos).',
            '',
        ]
        for name, result in evaluations.items():
            lines += [f'## Por síntoma — {name}', '', '| Síntoma | Casos | Precisión | Exhaustividad | F1 |', '|---|---|---|---|---|']
            for category, (precision, recall, f1, support) in result['per_category'].items():
                lines.append(f'| {category} | {support} | {precision:.0%} | {recall:.0%} | {f1:.0%} |')
            lines.append('')
        lines += ['## Errores del PLN local', '', 'Frases en las que lo extraído no coincide con la etiqueta (sirven para ampliar el vocabulario):', '']
        lines += [
            f'- «{row["text"]}» → esperado: {", ".join(sorted(row["symptoms"])) or "ninguno"}; '
            f'obtenido: {", ".join(sorted(predicted)) or "ninguno"}'
            for row, predicted in errors
        ] or ['- Ninguno.']
        lines += [
            '',
            '## Cómo se usa cada método en DentalSense',
            '',
            '- El **PLN local** decide el nivel de alerta: es explicable, no envía datos fuera y responde en milisegundos.',
            '- El **modelo de lenguaje** conversa, resume y explica; lo que extrae se guarda para compararlo con el PLN '
            'local, pero nunca cambia el nivel de alerta.',
            '',
        ]
        return '\n'.join(lines)

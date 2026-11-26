"""Carga o actualiza el vademécum de la clínica desde un archivo JSON (por defecto data/vademecum.json).

Uso:
    python manage.py load_vademecum                       # data/vademecum.json
    python manage.py load_vademecum --file nuevos.json    # otro archivo con el mismo formato
    python manage.py load_vademecum --dry-run             # solo valida, no guarda nada

Cada medicamento se identifica por su nombre genérico: si ya existe se actualiza, si no se crea.
Las marcas se suman a las que ya tenga (no se pierden las registradas desde la consulta).
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from medical_monitor.models import Medication

DEFAULT_FILE = Path(__file__).resolve().parents[2] / 'data' / 'vademecum.json'
REQUIRED = ('generic', 'group', 'presentations', 'frequencies', 'default_frequency', 'duration_days',
            'indications', 'common_effects', 'warning_signs')
TEXT_LIMITS = {'generic': 120, 'default_frequency': 60, 'with_food': 300}


def validate(item, position):
    """Devuelve la lista de errores de un medicamento del archivo (vacía si es válido)."""
    label = item.get('generic') or f'#{position}'
    errors = [f'{label}: falta «{key}»' for key in REQUIRED if item.get(key) in (None, '', [])]
    if item.get('group') and item['group'] not in Medication.Group.values:
        errors.append(f'{label}: grupo «{item["group"]}» no válido ({", ".join(Medication.Group.values)})')
    for index, presentation in enumerate(item.get('presentations') or []):
        if not isinstance(presentation, dict) or not presentation.get('strength') or not presentation.get('form'):
            errors.append(f'{label}: la presentación {index + 1} necesita «strength» y «form»')
    if item.get('default_frequency') and item['default_frequency'] not in (item.get('frequencies') or []):
        errors.append(f'{label}: «default_frequency» debe ser una de «frequencies»')
    if not isinstance(item.get('duration_days', 0), int) or item.get('duration_days', 0) < 0:
        errors.append(f'{label}: «duration_days» debe ser un número entero de días')
    for key, limit in TEXT_LIMITS.items():
        if len(str(item.get(key) or '')) > limit:
            errors.append(f'{label}: «{key}» supera {limit} caracteres')
    return errors


class Command(BaseCommand):
    help = 'Carga o actualiza el vademécum de la clínica desde un archivo JSON.'

    def add_arguments(self, parser):
        parser.add_argument('--file', default=str(DEFAULT_FILE), help='Archivo JSON con la clave "medications".')
        parser.add_argument('--dry-run', action='store_true', help='Solo valida el archivo.')

    def handle(self, *args, **options):
        path = Path(options['file'])
        try:
            items = json.loads(path.read_text(encoding='utf-8'))['medications']
        except FileNotFoundError as error:
            raise CommandError(f'No existe el archivo {path}') from error
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise CommandError(f'{path} no es un JSON con la clave "medications": {error}') from error

        errors = [error for position, item in enumerate(items, 1) for error in validate(item, position)]
        names = [item.get('generic', '').strip().lower() for item in items]
        errors += [f'«{name}» aparece repetido' for name in sorted({n for n in names if n and names.count(n) > 1})]
        if errors:
            raise CommandError('El archivo tiene errores:\n  - ' + '\n  - '.join(errors))
        if options['dry_run']:
            self.stdout.write(self.style.SUCCESS(f'{len(items)} medicamentos válidos (no se guardó nada).'))
            return

        created = updated = 0
        with transaction.atomic():
            for item in items:
                medication = Medication.objects.filter(generic_name__iexact=item['generic'].strip()).first()
                brands = list(dict.fromkeys([*(medication.brands if medication else []), *item.get('brands', [])]))
                values = {
                    'brands': brands, 'group': item['group'], 'presentations': item['presentations'],
                    'frequencies': item['frequencies'], 'default_frequency': item['default_frequency'],
                    'duration_days': item['duration_days'], 'with_food': item.get('with_food', ''),
                    'indications': item['indications'], 'mechanism': item.get('mechanism', ''),
                    'common_effects': item['common_effects'], 'warning_signs': item['warning_signs'],
                    'prescription_required': bool(item.get('prescription_required', False)),
                    'source': Medication.Source.CLINIC, 'sheet_ready': True, 'is_active': True,
                }
                if medication:
                    for field, value in values.items():
                        setattr(medication, field, value)
                    medication.save()
                    updated += 1
                else:
                    Medication.objects.create(generic_name=item['generic'].strip(), **values)
                    created += 1
        self.stdout.write(self.style.SUCCESS(f'Vademécum: {created} nuevos, {updated} actualizados.'))

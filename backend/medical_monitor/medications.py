"""Vademécum de la receta rápida: local primero, luego CIMA (AEMPS) y, al final, RxNav.

- La búsqueda devuelve cada fármaco con sus presentaciones reales (concentración, forma y vía), la
  frecuencia y la duración habituales, para que el odontólogo recete en tres clics.
- Una marca que no está en ninguna fuente pública (p. ej. una marca de Ecuador) se registra en el
  vademécum de la clínica con su principio activo; desde ahí se completan presentaciones y ficha.
- La ficha para el paciente sale del prospecto oficial de CIMA, resumida por la IA solo con ese texto.

A CIMA, RxNav y Gemini solo se envía el nombre del fármaco, nunca datos del paciente.
"""
import hashlib
import html
import http.client
import json
import re
import unicodedata
from html.parser import HTMLParser
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import threading

from django.conf import settings
from django.db import IntegrityError, close_old_connections, transaction
from pydantic import BaseModel, Field

from .caching import PATIENT_GUIDES, VADEMECUM, cached
from .models import AIInteraction, Medication, MedicationGuide

CIMA = 'https://cima.aemps.es/cima/rest'
RXNAV = 'https://rxnav.nlm.nih.gov/REST/drugs.json'
TIMEOUT = 4
SEARCH_CACHE = 'cima:busqueda:'
SEARCH_SECONDS = 24 * 3600
LIMIT = 8
NETWORK_ERRORS = (OSError, ValueError, TimeoutError, http.client.HTTPException)
CIMA_NOTE = 'Fuente: prospecto autorizado (CIMA-AEMPS), resumido por IA.'
CIMA_PLAIN_NOTE = 'Fuente: prospecto autorizado (CIMA-AEMPS).'
CLINIC_NOTE = 'Información general revisada por el equipo clínico.'
# Secciones del prospecto (tipo 2) y de la ficha técnica (tipo 1) que forman la ficha.
LEAFLET = {'1': 'para_que_sirve', '2': 'antes_de_tomar', '3': 'como_tomar', '4': 'efectos_adversos'}
MAX_SECTION = 4000


def fold(text):
    decomposed = unicodedata.normalize('NFKD', text or '')
    return ' '.join(''.join(char for char in decomposed if not unicodedata.combining(char)).casefold().split())


def fix_text(value):
    """CIMA devuelve algunas formas farmacéuticas con doble codificación («PELÃ\x8dCULA»)."""
    value = (value or '').strip()
    try:
        return value.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return value


def nice(value):
    value = fix_text(value)
    return value[:1].upper() + value[1:].lower() if value.isupper() else value


# --- Vademécum local ---------------------------------------------------------------------------------

def local_catalog():
    return cached(VADEMECUM, lambda: list(
        Medication.objects.filter(is_active=True).values(
            'id', 'generic_name', 'brands', 'group', 'presentations', 'frequencies', 'default_frequency',
            'duration_days', 'with_food', 'common_effects', 'source', 'prescription_required',
        )
    ))


def as_item(medication, brand=None):
    presentations = medication['presentations']
    return {
        'medication_id': medication['id'],
        'name': f'{brand} ({medication["generic_name"]})' if brand else medication['generic_name'],
        'active_ingredient': medication['generic_name'],
        'brand': brand,
        'source': 'Vademécum de la clínica' if medication['source'] == 'clinica' else 'CIMA',
        'presentations': presentations,
        'strength': presentations[0]['strength'] if len(presentations) == 1 else '',
        'frequencies': medication['frequencies'],
        'default_frequency': medication['default_frequency'],
        'duration_days': medication['duration_days'],
        'with_food': medication['with_food'],
        'common_effects': medication['common_effects'],
        'prescription_required': medication['prescription_required'],
        'rxcui': None,
    }


def _words(text):
    return re.findall(r'\w+', fold(text))


def search_local(term):
    """Genérico o marca: primero los que empiezan por el término; luego los que contienen todas sus palabras.

    «amoxicilina clavulanico» encuentra «Amoxicilina + ácido clavulánico».
    """
    wanted = fold(term)
    words = _words(term)
    starts, contains = [], []
    for medication in local_catalog():
        names = [(None, medication['generic_name'])] + [(brand, brand) for brand in medication['brands']]
        for brand, name in names:
            folded = fold(name)
            name_words = _words(name)
            if folded.startswith(wanted):
                starts.append(as_item(medication, brand))
                break
            if words and all(any(word.startswith(part) for word in name_words) for part in words):
                contains.append(as_item(medication, brand))
                break
    return starts + contains


def find_local(name):
    """Fármaco del vademécum cuyo genérico o marca coincide exactamente con `name`."""
    wanted = fold(name)
    for medication in Medication.objects.filter(is_active=True):
        if wanted in (fold(medication.generic_name), *map(fold, medication.brands)):
            return medication
    return None


# --- CIMA --------------------------------------------------------------------------------------------

def _get_json(url):
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'DentalSense/1.0'})
    with urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode('utf-8'))


def _cima_query(**params):
    try:
        data = _get_json(f'{CIMA}/medicamentos?{urlencode({**params, "comerc": 1})}')
    except NETWORK_ERRORS:
        return None
    return data.get('resultados', []) if isinstance(data, dict) else []


def group_cima(results):
    """Agrupa los registros de CIMA por principio activo con sus presentaciones sin repetir."""
    groups = {}
    for result in results:
        ingredient = ((result.get('vtm') or {}).get('nombre') or '').strip()
        if not ingredient:
            continue
        key = fold(ingredient)
        entry = groups.setdefault(key, {
            'name': ingredient[:1].upper() + ingredient[1:], 'presentations': [], 'registries': [],
            'prescription_required': False,
        })
        form = nice((result.get('formaFarmaceuticaSimplificada') or {}).get('nombre', ''))
        routes = result.get('viasAdministracion') or [{}]
        presentation = {'strength': (result.get('dosis') or '').strip(), 'form': form,
                        'route': nice(routes[0].get('nombre', ''))}
        if presentation['strength'] and presentation not in entry['presentations']:
            entry['presentations'].append(presentation)
        entry['registries'].append(result.get('nregistro'))
        entry['prescription_required'] = entry['prescription_required'] or bool(result.get('receta'))
    return list(groups.values())


def search_cima(term):
    def build():
        by_name = _cima_query(nombre=term)
        by_ingredient = _cima_query(practiv1=term)
        if by_name is None and by_ingredient is None:
            return None  # CIMA no respondió: no se guarda en caché.
        return group_cima((by_ingredient or []) + (by_name or []))

    key = f'{SEARCH_CACHE}{hashlib.sha1(fold(term).encode()).hexdigest()}'
    groups = cached(key, build)
    if groups is None:
        return None
    return [{
        'medication_id': None, 'name': group['name'], 'active_ingredient': group['name'], 'brand': None,
        'source': 'CIMA', 'presentations': group['presentations'][:12],
        'strength': group['presentations'][0]['strength'] if len(group['presentations']) == 1 else '',
        'frequencies': [], 'default_frequency': '', 'duration_days': 0, 'with_food': '', 'common_effects': '',
        'prescription_required': group['prescription_required'], 'rxcui': None,
    } for group in groups]


def search_rxnav(term):
    try:
        data = _get_json(f'{RXNAV}?name={quote(term)}')
    except NETWORK_ERRORS:
        return None
    items = []
    for group in (data.get('drugGroup') or {}).get('conceptGroup') or []:
        for concept in group.get('conceptProperties', []):
            name = concept.get('name', '').strip()
            if name:
                items.append({'medication_id': None, 'name': name, 'active_ingredient': name.split(' ')[0],
                              'brand': None, 'source': 'RxNav', 'presentations': [],
                              'strength': parse_strength(name), 'frequencies': [], 'default_frequency': '',
                              'duration_days': 0, 'with_food': '', 'common_effects': '',
                              'prescription_required': False, 'rxcui': concept.get('rxcui')})
    return items


def parse_strength(name):
    match = re.search(r'(\d+(?:[.,]\d+)?)\s*(mcg|mg|ml|g|%)(?![a-z])', name or '', re.IGNORECASE)
    return f'{match.group(1)} {match.group(2)}' if match else ''


def search(term, limit=LIMIT):
    """Busca en el vademécum local, CIMA y RxNav, en ese orden, sin repetir principios activos."""
    term = ' '.join((term or '').split())[:80]
    if len(term) < 2:
        return {'source': 'local', 'items': [], 'message': 'Escribe al menos dos letras.'}
    items = search_local(term)
    known = {fold(item['active_ingredient']) for item in items}
    message = ''
    # El vademécum de la clínica responde al instante; las fuentes externas solo si no lo tiene.
    if not items and len(term) >= 3:
        found = search_cima(term)
        if found is None:
            message = 'CIMA no respondió; se muestran las coincidencias del vademécum de la clínica.'
        else:
            items += [item for item in found if fold(item['active_ingredient']) not in known]
        if not items:
            items = search_rxnav(term) or []
    if not items:
        # Último recurso: las guías escritas por la clínica.
        for guide in MedicationGuide.objects.all():
            if fold(term) in fold(guide.name) or any(fold(term) in fold(word) for word in guide.search_terms):
                items.append({**as_item({'id': None, 'generic_name': guide.name, 'brands': [], 'group': 'otro',
                                         'presentations': [], 'frequencies': [], 'default_frequency': '',
                                         'duration_days': 0, 'with_food': '', 'common_effects': guide.common_effects,
                                         'source': 'clinica', 'prescription_required': False}),
                              'source': 'Catálogo local'})
        message = message or ('No está en el vademécum ni en CIMA. Si es una marca local, escribe su principio '
                              'activo y guárdala en el vademécum de la clínica.' if not items else '')
    source = items[0]['source'] if items else 'local'
    return {'source': source, 'items': items[:limit], 'message': message}


# --- Registro de una marca local ---------------------------------------------------------------------

@transaction.atomic
def register_brand(brand, active_ingredient, presentations=None):
    """Añade una marca al vademécum de la clínica, junto a su principio activo.

    Si el principio activo ya existe, la marca se suma a sus alias; si no, se crea el fármaco y se
    completan sus presentaciones con CIMA cuando las tiene.
    """
    brand, active_ingredient = ' '.join(brand.split())[:120], ' '.join(active_ingredient.split())[:120]
    existing = find_local(active_ingredient)
    if existing is not None:
        if fold(brand) != fold(existing.generic_name) and fold(brand) not in map(fold, existing.brands):
            existing.brands = [*existing.brands, brand]
            if presentations:
                existing.presentations = existing.presentations + [
                    item for item in presentations if item not in existing.presentations
                ]
            existing.save()
        return existing, False
    official = next((group for group in (search_cima(active_ingredient) or [])
                     if fold(group['active_ingredient']) == fold(active_ingredient)), None)
    try:
        medication = Medication.objects.create(
            generic_name=active_ingredient[:1].upper() + active_ingredient[1:],
            brands=[brand] if fold(brand) != fold(active_ingredient) else [],
            presentations=presentations or (official['presentations'] if official else []),
            prescription_required=bool(official and official['prescription_required']),
            source=Medication.Source.CLINIC,
        )
    except IntegrityError:
        medication = Medication.objects.get(generic_name__iexact=active_ingredient)
    return medication, True


# --- Ficha para el paciente desde el prospecto de CIMA ------------------------------------------------

class _TextOnly(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ('p', 'br', 'li', 'tr', 'div'):
            self.parts.append('\n')


def html_to_text(value):
    parser = _TextOnly()
    parser.feed(html.unescape(value or ''))
    lines = [' '.join(line.split()) for line in ''.join(parser.parts).splitlines()]
    return '\n'.join(line for line in lines if line)


def _section(kind, registry, section):
    try:
        data = _get_json(f'{CIMA}/docSegmentado/contenido/{kind}?nregistro={quote(str(registry))}&seccion={section}')
    except NETWORK_ERRORS:
        return ''
    if isinstance(data, list) and data:
        return html_to_text(data[0].get('contenido', ''))[:MAX_SECTION]
    return ''


def official_texts(active_ingredient):
    """Secciones del prospecto oficial del primer registro de CIMA que las tenga (se prueban hasta 3)."""
    results = _cima_query(practiv1=active_ingredient) or []
    registries = [item.get('nregistro') for item in results
                  if fold((item.get('vtm') or {}).get('nombre')) == fold(active_ingredient)] or \
                 [item.get('nregistro') for item in results]
    for registry in [item for item in registries if item][:3]:
        texts = {key: _section(2, registry, number) for number, key in LEAFLET.items()}
        if texts['para_que_sirve'] or texts['efectos_adversos']:
            texts['mecanismo'] = _section(1, registry, '5.1')[:1500]
            return registry, texts
    return None, None


class SheetOutput(BaseModel):
    para_que_sirve: str = Field(description='Para qué se usa, en una o dos frases sencillas.')
    como_actua: str = Field(description='Cómo actúa en el cuerpo, en una frase sencilla.')
    efectos_frecuentes: str = Field(description='Efectos adversos frecuentes, en una frase.')
    senales_de_alarma: str = Field(description='Señales por las que debe llamar a la clínica, en una frase.')
    con_alimentos: str = Field(description='Cómo tomarlo respecto a las comidas, en una frase.')


def sheet_system():
    return (
        'Eres un asistente de farmacia que escribe para pacientes de una clínica odontológica de Ecuador. '
        'Resume el prospecto oficial que recibes en español sencillo, frases cortas, sin tecnicismos. '
        'Usa SOLO la información del texto recibido: no añadas datos, dosis ni recomendaciones que no estén en él. '
        'Si un apartado no aparece en el texto, escribe «No se indica en el prospecto».'
    )


def _first_sentences(text, count=2):
    sentences = re.split(r'(?<=[.!?])\s+', ' '.join((text or '').split()))
    return ' '.join(sentences[:count])[:400]


def complete_sheet(medication):
    """Completa la ficha de un fármaco con su prospecto oficial. Devuelve False si CIMA no lo tiene."""
    from .ai.client import AIUnavailable, structured_call
    registry, texts = official_texts(medication.generic_name)
    if registry is None:
        return False
    try:
        output, _model = structured_call(
            AIInteraction.Feature.MEDICATION, system=sheet_system(),
            user=json.dumps({'medicamento': medication.generic_name, 'prospecto': texts}, ensure_ascii=False),
            output_format=SheetOutput, effort='low', max_tokens=900,
        )
        values = {
            'indications': output.para_que_sirve, 'mechanism': output.como_actua,
            'common_effects': output.efectos_frecuentes, 'warning_signs': output.senales_de_alarma,
            'with_food': output.con_alimentos[:300],
        }
        note = CIMA_NOTE
    except AIUnavailable:
        values = {
            'indications': _first_sentences(texts['para_que_sirve']),
            'mechanism': _first_sentences(texts.get('mecanismo'), 1),
            'common_effects': _first_sentences(texts['efectos_adversos']),
            'warning_signs': '',
            'with_food': '',
        }
        note = CIMA_PLAIN_NOTE
    # Lo que la clínica ya escribió no se sobrescribe.
    for field, value in values.items():
        if not getattr(medication, field) and value:
            setattr(medication, field, value)
    medication.cima_registry = str(registry)
    medication.sheet_ready = True
    medication.save()
    medication.sheet_note = note
    return True


def sheet_payload(medication, note=None):
    return {
        'id': medication.id,
        'name': medication.generic_name,
        'brands': medication.brands,
        'indications': medication.indications,
        'mechanism': medication.mechanism,
        'common_effects': medication.common_effects,
        'warning_signs': medication.warning_signs,
        'what_to_do': medication.with_food,
        'source': medication.source,
        'source_note': note or getattr(medication, 'sheet_note', None) or (
            CLINIC_NOTE if medication.source == Medication.Source.CLINIC and not medication.cima_registry else CIMA_NOTE
        ),
    }


def sheet_for(name):
    """Ficha de un fármaco por genérico o marca. Si solo existe en CIMA, se incorpora al vademécum."""
    medication = find_local(name)
    if medication is None:
        official = next(iter(search_cima(name) or []), None)
        if official is None:
            return None
        medication, _ = Medication.objects.get_or_create(
            generic_name=official['active_ingredient'],
            defaults={'presentations': official['presentations'], 'source': Medication.Source.CIMA,
                      'prescription_required': official['prescription_required']},
        )
    if not medication.sheet_ready and not complete_sheet(medication):
        if not (medication.indications or medication.common_effects):
            return None
    return sheet_payload(medication)


def prepare_sheet_later(name):
    """Al recetar un fármaco sin ficha, la prepara después de responder: el paciente la verá en su receta."""
    if not name or find_medication_guide_name(name):
        return

    def run():
        try:
            sheet_for(name)
        except Exception:  # Una fuente externa caída no debe afectar a la consulta ya guardada.
            pass
        finally:
            if settings.AI_IN_BACKGROUND:
                close_old_connections()

    def start():
        if settings.AI_IN_BACKGROUND:
            threading.Thread(target=run, daemon=True).start()
        else:
            run()

    transaction.on_commit(start)


def find_medication_guide_name(name):
    medication = find_local(name)
    return medication is not None and medication.sheet_ready


# --- Guía para el paciente en su receta ---------------------------------------------------------------

def guidance_catalog():
    """Guías para el paciente: las escritas por la clínica primero y luego las del vademécum."""
    def build():
        guides = [{
            'name': guide.name, 'terms': [guide.name, *guide.search_terms], 'common_effects': guide.common_effects,
            'what_to_do': guide.what_to_do, 'warning_signs': guide.warning_signs, 'source_note': guide.source_note,
            'indications': '', 'mechanism': '',
        } for guide in MedicationGuide.objects.all()]
        for medication in Medication.objects.filter(is_active=True).exclude(indications='', common_effects=''):
            payload = sheet_payload(medication)
            entry = {**payload, 'terms': [medication.generic_name, *medication.brands]}
            same = next((guide for guide in guides if fold(guide['name']) == fold(medication.generic_name)), None)
            if same is not None:
                # La guía de la clínica manda; el vademécum solo aporta lo que le falta.
                same['indications'] = same['indications'] or entry['indications']
                same['mechanism'] = same['mechanism'] or entry['mechanism']
                same['terms'] += [term for term in entry['terms'] if term not in same['terms']]
            else:
                guides.append(entry)
        return guides

    return cached(PATIENT_GUIDES, build)

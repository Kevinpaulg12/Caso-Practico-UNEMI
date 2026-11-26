"""Extracción de entidades clínicas en español con spaCy.

Un EntityRuler reconoce síntomas, medicamentos, dosis y frecuencias. Para cada síntoma
se estima la intensidad y si está negado ("ya no me duele", "sin sangrado") a partir de
las palabras cercanas, sin cruzar signos de puntuación ni conjunciones.
"""
import unicodedata

import spacy
from spacy.util import filter_spans

ACCENTED = {'a': '[aá]', 'e': '[eé]', 'i': '[ií]', 'o': '[oó]', 'u': '[uúü]'}

# Cada patrón es una palabra (alternativas con |) o una lista de palabras consecutivas.
# Una palabra terminada en ? es opcional.
SYMPTOMS = {
    'Dolor': ['dolor|dolores|duele|duelen|molestia|molestias|punzada|punzadas|punzante'],
    'Inflamación': [
        'inflamacion|inflamado|inflamada|inflamados|inflamadas|hinchazon|hinchado|hinchada|hinchados|hinchadas|edema',
    ],
    'Sangrado': ['sangrado|sangra|sangran|sangre|sangrando|hemorragia'],
    'Fiebre': ['fiebre|calentura|febril'],
    'Signos de infección': ['pus|supura|supuracion', ['mal', 'olor|sabor|aliento']],
    'Apertura bucal limitada': ['trismo', ['no', 'puedo|logro', 'abrir', 'la?', 'boca']],
    'Dificultad para tragar o respirar': [
        'disfagia|disnea',
        ['dificultad', 'para|al', 'tragar|respirar|deglutir'],
        ['no', 'puedo|logro', 'tragar|respirar'],
    ],
    'Adormecimiento': ['adormecido|adormecida|adormecimiento|hormigueo|entumecido|entumecida'],
    'Náusea o vómito': ['nausea|nauseas|vomito|vomitos|vomitar|mareo|mareos'],
    # Síntomas de tratamientos no quirúrgicos (endodoncia, ortodoncia, periodoncia, prótesis...).
    'Sensibilidad dental': [
        'sensibilidad|sensible|sensibles|dentera',
        ['duele|duelen|molesta|molestan', 'con', 'lo|el|la?', 'frio|fria|caliente|helado|helada|dulce'],
    ],
    'Dolor al morder': [
        ['duele|duelen|dolor|molesta|molestia', 'al', 'morder|masticar|comer|cerrar'],
        ['no', 'puedo|logro', 'morder|masticar'],
    ],
    'Movilidad dental': [
        ['se', 'me?', 'mueve|mueven|menea|menean'],
        ['diente|dientes|muela|muelas|implante|corona', 'flojo|floja|flojos|flojas'],
        'movilidad',
    ],
    'Llaga o úlcera': ['llaga|llagas|yaga|yagas|ulcera|ulceras|afta|aftas|lastimadura|lastimaduras|ampolla|ampollas'],
    'Aparato suelto o roto': [
        ['bracket|brackets|braket|brakets|aparato|retenedor|alambre|arco|ligas?|ferula|alineador|alineadores',
         'suelto|suelta|sueltos|despegado|despegada|despegados|roto|rota|rotos|caido|caida'],
        ['se', 'me?', 'despego|despegaron|cayo|cayeron|rompio|rompieron|solto|soltaron|salio',
         'el|la|los|las|un|una?', 'bracket|brackets|braket|brakets|aparato|retenedor|alambre|arco|alineador|ferula'],
    ],
    'Alambre que lastima': [
        ['alambre|arco|bracket|brackets', 'me?', 'lastima|lastiman|pincha|pinchan|punza|corta|raspa|roza'],
    ],
    'Prótesis desajustada': [
        ['protesis|dentadura|placa|puente', 'me?', 'aprieta|lastima|roza|cae|mueve|sale|baila'],
        ['protesis|dentadura|placa|puente', 'se', 'me?', 'cae|mueve|sale|suelta'],
        ['protesis|dentadura|placa|puente', 'floja|suelta|desajustada|apretada'],
        ['protesis|dentadura|placa|puente', 'me?', 'queda', 'floja|grande|apretada|mal'],
    ],
    'Restauración caída o fractura': [
        ['se', 'me?', 'cayo|salio|rompio|partio|fracturo|despego', 'la|el?',
         'calza|resina|obturacion|curacion|corona|carilla|empaste|tapadura|amalgama|provisional'],
        ['diente|muela|corona|carilla|calza', 'esta|quedo|se?',
         'roto|rota|partido|partida|fracturado|fracturada|astillado|astillada|partio|rompio'],
        'fractura|fracturado|fracturada',
    ],
    'Sangrado de encías': [
        ['sangran|sangra|sangrado|sangrando', 'las|mis?', 'encias'],
        ['encias', 'sangran|sangrantes|sangrando'],
        ['sangrado|sangran|sangra', 'al', 'cepillar|cepillarme|cepillarse'],
    ],
    'Retracción de encía': [
        ['encia|encias', 'retraida|retraidas|bajada|bajadas'],
        'retraccion',
    ],
}

# Cuidados que el paciente menciona: miden la adherencia ("no me puse los elásticos").
CARE = {
    'Cepillado': ['cepille|cepillo|cepillarme|cepillado|cepillar|cepillamos'],
    'Hilo dental': [['hilo', 'dental'], 'interdental'],
    'Enjuague': ['enjuague|enjuagues|enjuagar|enjuagarme|colutorio'],
    'Elásticos': ['elastico|elasticos'],
    'Alineadores': [['use|uso|puse|lleve|llevo', 'los?', 'alineador|alineadores']],
    'Férula o retenedor': [['use|uso|puse|lleve|llevo', 'la|el', 'ferula|retenedor']],
    'Frío local': ['hielo|compresa|compresas'],
    'Medicación': [
        ['tome|tomo|tomé', 'la|el|las|los|mis?|mi', 'pastilla|pastillas|medicina|medicinas|medicamento|medicamentos|'
         'medicacion|antibiotico|antibioticos|analgesico|analgesicos|tableta|tabletas|capsula|capsulas|dosis|'
         'ibuprofeno|paracetamol|amoxicilina|receta'],
        ['ya', 'me', 'la|las|lo|los', 'tome'],
    ],
}
WORD_NUMBERS = {'un': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7,
                'ocho': 8, 'diez': 10, 'quince': 15, 'varios': 3, 'varias': 3, 'unos': 2, 'unas': 2}
UNIT_DAYS = {'hora': 0, 'horas': 0, 'dia': 1, 'dias': 1, 'semana': 7, 'semanas': 7, 'mes': 30, 'meses': 30}
SINCE = {'ayer': 1, 'anoche': 1, 'antier': 2, 'anteayer': 2, 'hoy': 0}
MEDICATIONS = (
    'paracetamol|acetaminofen|ibuprofeno|ibuprofen|amoxicilina|clindamicina|ketorolaco|naproxeno|'
    'diclofenaco|metronidazol|clorhexidina|dexametasona|azitromicina|tramadol|nimesulida|celecoxib'
)
DOSE_UNITS = 'mg|g|gr|ml|mcg|ui|%'

HIGH = {'mucho', 'mucha', 'muchisimo', 'muchisima', 'intenso', 'intensa', 'fuerte', 'fuertes', 'abundante',
        'severo', 'severa', 'insoportable', 'demasiado', 'demasiada', 'terrible', 'horrible', 'constante',
        'persistente'}
MODERATE = {'moderado', 'moderada', 'bastante', 'regular'}
LOW = {'leve', 'poco', 'poca', 'poquito', 'ligero', 'ligera', 'ligeramente', 'algo'}
NEGATORS = {'no', 'sin', 'ni', 'niego', 'nada'}
BOUNDARIES = {'y', 'pero', 'aunque', 'e', 'o'}
INTENSITY_RANK = {None: 0, 'leve': 1, 'moderada': 2, 'alta': 3}


def plain(text):
    decomposed = unicodedata.normalize('NFKD', text)
    return ''.join(char for char in decomposed if not unicodedata.combining(char)).casefold()


def _token(word):
    optional = word.endswith('?')
    word = word.rstrip('?')
    regex = ''.join(ACCENTED.get(char, char) for char in word)
    token = {'LOWER': {'REGEX': f'^(?:{regex})$'}}
    if optional:
        token['OP'] = '?'
    return token


def _pattern(spec):
    return [_token(word) for word in (spec if isinstance(spec, list) else [spec])]


def _build_pipeline():
    pipeline = spacy.load('es_core_news_sm', exclude=['ner', 'parser'])
    ruler = pipeline.add_pipe('entity_ruler')
    patterns = [
        {'label': 'SINTOMA', 'id': category, 'pattern': _pattern(spec)}
        for category, specs in SYMPTOMS.items()
        for spec in specs
    ]
    patterns += [
        {'label': 'CUIDADO', 'id': category, 'pattern': _pattern(spec)}
        for category, specs in CARE.items()
        for spec in specs
    ]
    patterns += [
        {'label': 'DURACION', 'pattern': [_token('hace|desde|durante|por|llevo'),
                                          {'LOWER': {'REGEX': r'^(?:\d+|' + '|'.join(WORD_NUMBERS) + ')$'}, 'OP': '?'},
                                          _token('hora|horas|dia|dias|semana|semanas|mes|meses')]},
        {'label': 'DURACION', 'pattern': [_token('desde'), _token('|'.join(SINCE))]},
        {'label': 'MEDICAMENTO', 'pattern': _pattern(MEDICATIONS)},
        {'label': 'DOSIS', 'pattern': [{'LIKE_NUM': True}, _token(DOSE_UNITS)]},
        {'label': 'DOSIS', 'pattern': [{'LOWER': {'REGEX': r'^\d+(?:[.,]\d+)?(?:mg|g|ml|mcg)$'}}]},
        {'label': 'FRECUENCIA', 'pattern': [_token('cada'), {'LIKE_NUM': True, 'OP': '?'},
                                            _token('hora|horas|dia|dias|noche|noches')]},
    ]
    ruler.add_patterns(patterns)
    return pipeline


nlp = _build_pipeline()


def _window(doc, entity, direction, size):
    """Palabras vecinas de la entidad, sin cruzar puntuación, conjunciones ni otras entidades."""
    words = []
    index = entity.start - 1 if direction < 0 else entity.end
    while 0 <= index < len(doc) and len(words) < size:
        token = doc[index]
        word = plain(token.text)
        if token.is_punct or word in BOUNDARIES or token.ent_type_:
            break
        words.append(word)
        index += direction
    return words if direction > 0 else list(reversed(words))


def _intensity(before, after):
    following = ' '.join(after)
    if 'no para' in following or 'no se detiene' in following or 'no se quita' in following:
        return 'alta'
    words = set(before) | set(after)
    if words & HIGH:
        return 'alta'
    if words & MODERATE:
        return 'moderada'
    if words & LOW:
        return 'leve'
    if 'muy' in words:
        return 'alta'
    return None


def extract_entities(text):
    """Devuelve las entidades clínicas del texto en un formato serializable."""
    doc = nlp(text or '')
    entities = []
    for entity in filter_spans(doc.ents):
        if entity.label_ == 'CUIDADO':
            # "no me puse los elásticos": la negación puede estar hasta cuatro palabras antes.
            entities.append({
                'text': entity.text, 'label': 'CUIDADO', 'category': entity.ent_id_,
                'negated': bool(NEGATORS & set(_window(doc, entity, -1, 4))),
            })
            continue
        if entity.label_ == 'DURACION':
            entities.append({'text': entity.text, 'label': 'DURACION', 'days': duration_days(entity.text)})
            continue
        if entity.label_ != 'SINTOMA':
            entities.append({'text': entity.text, 'label': entity.label_})
            continue
        before = _window(doc, entity, -1, 3)
        after = _window(doc, entity, 1, 4)
        starts_with_negation = plain(entity[0].text) == 'no'
        entities.append({
            'text': entity.text,
            'label': 'SINTOMA',
            'category': entity.ent_id_,
            'intensity': _intensity(before, after),
            'negated': not starts_with_negation and bool(NEGATORS & set(before)),
        })
    return entities


def duration_days(text):
    """'hace 3 días' -> 3, 'desde ayer' -> 1, 'hace una semana' -> 7, 'hace unas horas' -> 0."""
    words = plain(text).split()
    if words[-1] in SINCE:
        return SINCE[words[-1]]
    unit = UNIT_DAYS.get(words[-1], 1)
    amount = next((int(word) if word.isdigit() else WORD_NUMBERS[word]
                   for word in words[1:-1] if word.isdigit() or word in WORD_NUMBERS), 1)
    return amount * unit


def longest_duration(entities):
    """Mayor duración mencionada (en días) o None si el paciente no la indicó."""
    values = [entity['days'] for entity in entities if entity.get('label') == 'DURACION']
    return max(values) if values else None


def care_mentions(entities):
    """Cuidados mencionados: {'Elásticos': False} si dijo que no los usó."""
    found = {}
    for entity in entities:
        if entity.get('label') == 'CUIDADO':
            found[entity['category']] = found.get(entity['category'], True) and not entity['negated']
    return found


def affirmed_symptoms(entities):
    """Síntomas no negados, con la mayor intensidad mencionada por categoría."""
    found = {}
    for entity in entities:
        if entity.get('label') != 'SINTOMA' or entity.get('negated'):
            continue
        current = found.get(entity['category'])
        if entity['category'] not in found or INTENSITY_RANK[entity['intensity']] > INTENSITY_RANK[current]:
            found[entity['category']] = entity['intensity']
    return found

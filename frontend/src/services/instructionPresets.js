/**
 * Frases rápidas para que el odontólogo no tenga que escribir las indicaciones de siempre.
 * Cada campo tiene grupos por tema; algunas especialidades suman sus propias frases.
 * Son textos cortos y para el paciente: se pueden editar después de añadirlos.
 */

const GENERAL = {
  instructions: [
    ['Higiene', [
      'Cepíllate con suavidad después de cada comida.',
      'Usa un cepillo de cerdas suaves.',
      'Enjuágate con clorhexidina dos veces al día durante 7 días.',
      'No te enjuagues con fuerza las primeras 24 horas.',
      'Usa hilo dental con cuidado, sin lastimar la encía.',
    ]],
    ['Actividad', [
      'Haz reposo relativo el resto del día.',
      'Evita el ejercicio intenso durante 48 horas.',
      'Duerme con la cabeza un poco elevada la primera noche.',
      'No fumes ni bebas alcohol durante al menos 72 horas.',
    ]],
    ['Dolor y medicación', [
      'Toma la medicación en los horarios indicados, aunque no tengas dolor.',
      'Aplica frío por fuera de la cara 15 minutos cada hora durante el primer día.',
      'No tomes medicamentos que no te haya indicado tu odontólogo.',
      'Completa el antibiótico hasta el último día.',
    ]],
    ['Señales de alarma', [
      'Si el sangrado no se detiene tras 30 minutos de presión, comunícate con la clínica.',
      'Si tienes fiebre de más de 38 °C, avísanos de inmediato.',
      'Si la hinchazón aumenta después del tercer día, avísanos.',
      'Si te cuesta tragar o respirar, acude a urgencias.',
    ]],
  ],
  diet: [
    ['Dieta', [
      'Dieta blanda y fría las primeras 24 horas.',
      'Evita alimentos duros, pegajosos o crocantes.',
      'No tomes bebidas calientes durante el primer día.',
      'Mastica del lado contrario al tratado.',
      'No uses sorbete durante 3 días.',
      'Bebe abundante agua.',
      'Evita comidas muy condimentadas o ácidas.',
    ]],
  ],
  side_effects: [
    ['Efectos', [
      'Molestia o dolor leve los primeros días.',
      'Hinchazón leve que mejora a partir del tercer día.',
      'Sangrado leve durante las primeras horas.',
      'Sensibilidad al frío o al calor.',
      'Malestar estomacal leve por la medicación.',
      'Somnolencia leve por la medicación.',
    ]],
  ],
};

// Lo propio de cada especialidad: se muestra primero, en su propio grupo.
const BY_SPECIALTY = {
  cirugia: {
    instructions: [
      'Muerde la gasa durante 30 minutos sin cambiarla.',
      'No escupas ni succiones la herida.',
      'No toques la herida con la lengua ni con los dedos.',
      'Los puntos se retiran en el próximo control.',
    ],
    side_effects: ['Dificultad leve para abrir la boca.', 'Moretón en la mejilla.'],
  },
  endodoncia: {
    instructions: [
      'No mastiques con el diente tratado hasta tener la restauración definitiva.',
      'Si se cae la curación temporal, avísanos.',
    ],
    side_effects: ['Molestia al morder durante unos días.'],
  },
  ortodoncia: {
    instructions: [
      'Usa cera de ortodoncia si un bracket o alambre te lastima.',
      'Usa los elásticos como te indicamos, todo el día.',
      'Usa cepillo interdental alrededor de los brackets.',
      'Si se suelta un bracket, guárdalo y avísanos.',
    ],
    diet: ['Evita chicles, caramelos y alimentos duros que despeguen los brackets.', 'Corta las frutas y el pan en trozos pequeños.'],
    side_effects: ['Presión o molestia en los dientes los primeros días tras el ajuste.', 'Pequeñas llagas por el roce de los brackets.'],
  },
  implantologia: {
    instructions: [
      'No presiones ni mastiques sobre la zona del implante.',
      'No uses la prótesis removible hasta que te lo indiquemos.',
    ],
  },
  periodoncia: {
    instructions: [
      'Usa cepillo interdental todos los días.',
      'Cepilla la encía con movimientos suaves, de la encía hacia el diente.',
    ],
    side_effects: ['Sensibilidad dental durante algunas semanas.', 'La encía puede verse un poco retraída.'],
  },
  protesis: {
    instructions: [
      'Retira la prótesis por la noche y guárdala en agua.',
      'Limpia la prótesis después de cada comida.',
      'Si la prótesis te lastima, no la uses y avísanos.',
    ],
    side_effects: ['Aumento de saliva los primeros días.', 'Zonas de roce o llagas pequeñas.'],
  },
  odontopediatria: {
    instructions: [
      'Vigila que el niño no se muerda el labio mientras dure la anestesia.',
      'Un adulto debe supervisar el cepillado.',
    ],
  },
  estetica: {
    instructions: ['Evita café, té, vino y bebidas con colorantes durante 48 horas.'],
    side_effects: ['Sensibilidad dental pasajera.'],
  },
};

const SPECIALTY_GROUP = 'De este tratamiento';

/** Grupos de frases para un campo: [[título, [frases]], ...]. Primero las de la especialidad. */
export function presetsFor(field, specialty) {
  const own = BY_SPECIALTY[specialty]?.[field];
  return [...(own?.length ? [[SPECIALTY_GROUP, own]] : []), ...(GENERAL[field] ?? [])];
}

/** El texto con la frase añadida al final (o quitada si ya estaba). */
export function togglePhrase(text, phrase) {
  if (text.includes(phrase)) {
    return text.replace(phrase, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{2,}/g, '\n').trim();
  }
  const base = text.trim();
  return base ? `${base}${/[.!?]$/.test(base) ? '' : '.'} ${phrase}` : phrase;
}

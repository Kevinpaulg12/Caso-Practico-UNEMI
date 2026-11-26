import { IconPill, IconCheckCircle, IconSparkles } from './Icons';

// La curva de evolución del dolor la ve solo el odontólogo: al paciente podía abrumarlo.
export const PATIENT_SECTIONS = [
  { id: 'tratamiento', label: 'Mi tratamiento', icon: IconPill, subtitle: 'Tus indicaciones y el avance de tu tratamiento.' },
  { id: 'asistente', label: 'Asistente', icon: IconSparkles, subtitle: 'Cuéntale al asistente cómo te sientes, resuelve dudas sobre tus indicaciones o pide una cita.' },
  { id: 'cuidados', label: 'Mis cuidados', icon: IconCheckCircle, subtitle: 'La medicación que te recetaron, cómo tomarla y sus posibles efectos secundarios.' },
];
export const PATIENT_SECTION_IDS = PATIENT_SECTIONS.map((item) => item.id);
// La sección vive en la URL: recargar o volver atrás la mantiene, y el menú lateral son enlaces normales.
export const patientSectionPath = (id) => (id === 'tratamiento' ? '/panel-paciente' : `/panel-paciente?seccion=${id}`);

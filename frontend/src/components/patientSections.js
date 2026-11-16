import { IconPill, IconCheckCircle, IconSparkles, IconChartBar } from './Icons';

export const PATIENT_SECTIONS = [
  { id: 'tratamiento', label: 'Mi tratamiento', icon: IconPill, subtitle: 'Tus indicaciones, tu medicación y el avance de tu tratamiento.' },
  { id: 'asistente', label: 'Asistente', icon: IconSparkles, subtitle: 'Cuéntale al asistente cómo te sientes: tu odontólogo verá el reporte en su panel.' },
  { id: 'cuidados', label: 'Mis cuidados', icon: IconCheckCircle, subtitle: 'Marca los cuidados que cumpliste hoy.' },
  { id: 'evolucion', label: 'Evolución', icon: IconChartBar, subtitle: 'Cómo ha cambiado tu dolor y los reportes que has enviado.' },
];
export const PATIENT_SECTION_IDS = PATIENT_SECTIONS.map((item) => item.id);
// La sección vive en la URL: recargar o volver atrás la mantiene, y el menú lateral son enlaces normales.
export const patientSectionPath = (id) => (id === 'tratamiento' ? '/panel-paciente' : `/panel-paciente?seccion=${id}`);

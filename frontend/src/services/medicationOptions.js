// Opciones de la receta, compartidas por la consulta médica y la edición de tratamientos.
export const DEFAULT_STRENGTHS = ['100 mg', '200 mg', '250 mg', '400 mg', '500 mg', '600 mg', '650 mg', '750 mg', '875 mg', '1000 mg', '0.12 %', '2 %'];
export const DOSAGE_FORMS = ['Tableta', 'Cápsula', 'Jarabe', 'Suspensión', 'Crema', 'Gotas'];
export const FREQUENCIES = ['Cada 4 horas', 'Cada 6 horas', 'Cada 8 horas', 'Cada 12 horas', 'Una vez al día', 'Según necesidad'];
// Mismo formato que valida el servidor: «3 días», «2 semanas», «1 mes».
export const DURATION_PATTERN = /^[1-9]\d{0,2}\s*(día|días|semana|semanas|mes|meses)$/i;

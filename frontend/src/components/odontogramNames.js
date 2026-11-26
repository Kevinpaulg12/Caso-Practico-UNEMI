// Nombre de cada pieza dental en notación FDI (11–48 permanentes, 51–85 temporales).
const TOOTH_NAMES = { 1: 'incisivo central', 2: 'incisivo lateral', 3: 'canino', 4: 'primer premolar', 5: 'segundo premolar', 6: 'primer molar', 7: 'segundo molar', 8: 'tercer molar' };
const PRIMARY_NAMES = { 1: 'incisivo central temporal', 2: 'incisivo lateral temporal', 3: 'canino temporal', 4: 'primer molar temporal', 5: 'segundo molar temporal' };
const QUADRANTS = { 1: 'superior derecho', 2: 'superior izquierdo', 3: 'inferior izquierdo', 4: 'inferior derecho', 5: 'superior derecho', 6: 'superior izquierdo', 7: 'inferior izquierdo', 8: 'inferior derecho' };

export function toothName(number) {
  const quadrant = Math.floor(number / 10);
  const position = number % 10;
  const name = quadrant >= 5 ? PRIMARY_NAMES[position] : TOOTH_NAMES[position];
  return `${number}: ${name} ${QUADRANTS[quadrant]}`;
}

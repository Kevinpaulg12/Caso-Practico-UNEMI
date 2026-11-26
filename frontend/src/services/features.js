// Línea de productos: el servidor informa en /api/me/ qué características tiene la variante en
// ejecución (p. ej., { reports: false, notifications: true }). Una característica que el servidor no
// menciona se considera activa, para que una API anterior siga mostrando todo.
export function hasFeature(user, name) {
  return user?.features?.[name] !== false;
}

// Nombre comercial de la variante, p. ej. «DentalSense Básico · variante A».
export function productLabel(user) {
  const { product, variant } = user?.features ?? {};
  if (!product) return '';
  return variant ? `${product} · variante ${variant}` : product;
}

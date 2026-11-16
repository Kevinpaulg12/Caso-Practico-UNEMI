import api from './api';

const MAX_PAGES = 100;
// La API pagina de 10 en 10 por defecto; para traer una lista completa se piden páginas de 100
// (el máximo que admite), así un historial largo llega en una petición y no en diez.
const PAGE_SIZE = 100;

// Recorre todas las páginas de una lista.
export async function fetchAll(url, params = {}) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data } = await api.get(url, { params: { ...params, page, page_size: PAGE_SIZE } });
    if (!data.results) return data;
    items.push(...data.results);
    if (!data.next) break;
  }
  return items;
}

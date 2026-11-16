import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

export function renderAt(ui, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

// Convierte { '/ruta/': datos } en una implementación de api.get
export function apiRoutes(routes) {
  return async (url) => {
    if (!(url in routes)) throw new Error(`GET no simulado: ${url}`);
    return { data: routes[url] };
  };
}

export const page = (results, count = results.length) => ({ count, next: null, previous: null, results });

import { useEffect, useState } from 'react';

// Devuelve el valor cuando deja de cambiar durante `delay` ms: evita una petición por cada tecla.
export default function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

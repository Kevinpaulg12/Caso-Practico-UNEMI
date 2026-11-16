import { useEffect, useState } from 'react';
import api from '../../services/api';

const BACKGROUND = { headers: { 'X-Background-Request': '1' } };

// Recordatorios vigentes: cita próxima, reporte pendiente y cuidados del día.
export default function RemindersBanner({ onAction }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.get('/reminders/', BACKGROUND).then(({ data }) => setItems(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  if (!items.length) return null;
  const actions = { report: ['asistente', 'Reportar ahora'], care: ['cuidados', 'Marcar cuidados'] };
  return (
    <ul aria-label="Recordatorios" className="space-y-2">
      {items.map((item) => (
        <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
          <span><span aria-hidden="true">🔔 </span>{item.text}</span>
          {actions[item.kind] && (
            <button type="button" onClick={() => onAction?.(actions[item.kind][0])} className="rounded-lg bg-white px-3 py-1.5 font-bold text-blue-700 hover:bg-blue-100">
              {actions[item.kind][1]}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

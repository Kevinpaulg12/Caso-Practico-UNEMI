import { useEffect, useState } from 'react';
import api from '../../services/api';
import { IconCalendar, IconCheckCircle } from '../Icons';

const BACKGROUND = { headers: { 'X-Background-Request': '1' } };
// La invitación diaria a conversar no se muestra como aviso: el asistente ya está a un clic en el menú.
const HIDDEN_KINDS = new Set(['report']);

// Recordatorios vigentes: próximo control y cuidados.
export default function RemindersBanner({ onAction }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.get('/reminders/', BACKGROUND)
      .then(({ data }) => setItems(Array.isArray(data) ? data.filter((item) => !HIDDEN_KINDS.has(item.kind)) : []))
      .catch(() => {});
  }, []);

  if (!items.length) return null;
  const actions = { care: ['cuidados', 'Ver mis cuidados'] };
  return (
    <ul aria-label="Recordatorios" className="space-y-2">
      {items.map((item) => {
        const Icon = item.kind === 'care' ? IconCheckCircle : IconCalendar;
        return (
          <li key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
            <span className="flex items-center gap-2"><Icon className="h-4 w-4 shrink-0 text-blue-600" />{item.text}</span>
            {actions[item.kind] && (
              <button type="button" onClick={() => onAction?.(actions[item.kind][0])} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-bold text-blue-700 hover:bg-blue-100">
                <IconCheckCircle className="h-3.5 w-3.5" />{actions[item.kind][1]}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

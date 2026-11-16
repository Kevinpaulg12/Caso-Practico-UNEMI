import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { page } from '../test/utils';
import AISummaryCard from './AISummaryCard';
import Odontogram, { toothName } from './Odontogram';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe('Odontograma (FDI)', () => {
  it('selecciona y deselecciona piezas en orden', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Odontogram value={[]} onChange={onChange} />);
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(32);
    fireEvent.click(screen.getByRole('button', { name: /^36:/ }));
    expect(onChange).toHaveBeenLastCalledWith([36]);
    rerender(<Odontogram value={[36]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^11:/ }));
    expect(onChange).toHaveBeenLastCalledWith([11, 36]);
    fireEvent.click(screen.getByRole('button', { name: /^36:/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('cambia a dentición temporal y nombra cada pieza', () => {
    const onDentitionChange = vi.fn();
    render(<Odontogram value={[]} onChange={() => {}} dentition="primary" onDentitionChange={onDentitionChange} />);
    expect(screen.getAllByRole('button', { name: /temporal/ }).length).toBe(20);
    fireEvent.click(screen.getByRole('button', { name: 'Permanente' }));
    expect(onDentitionChange).toHaveBeenCalledWith('permanent');
    expect(toothName(48)).toBe('48: tercer molar inferior derecho');
    expect(toothName(64)).toBe('64: primer molar temporal superior izquierdo');
  });

  it('en modo lectura no se puede editar', () => {
    render(<Odontogram value={[21]} readOnly />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/Piezas: 21: incisivo central superior izquierdo/)).toBeInTheDocument();
  });
});

describe('Resumen clínico (IA)', () => {
  const plan = { id: 5, is_active: true, surgery_date: '2026-11-01', created_at: '2026-11-01T10:00:00Z' };
  const summary = {
    id: 1, source: 'llm', model: 'gemini-2.5-flash', created_at: '2026-11-05T10:00:00Z', reports_included: 4,
    content: { resumen: 'Evolución favorable.', cambios_recientes: ['Dolor en descenso'], alertas: [], adherencia: '80 %',
      puntos_a_revisar: ['Revisar el bracket'], aviso: 'Resumen de apoyo: no sustituye la valoración clínica del odontólogo.' },
  };

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.get.mockImplementation(async (url) => (url === '/treatment-plans/' ? { data: page([plan]) } : { data: null }));
  });

  it('genera el resumen y muestra quién lo redactó', async () => {
    api.post.mockResolvedValue({ data: summary });
    render(<AISummaryCard patientId={9} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generar resumen' }));
    expect(await screen.findByText('Evolución favorable.')).toBeInTheDocument();
    expect(screen.getByText(/Redactado por IA \(gemini-2.5-flash\)/)).toBeInTheDocument();
    expect(screen.getByText('Revisar el bracket')).toBeInTheDocument();
    expect(screen.getByText(/no sustituye la valoración clínica/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/treatment-plans/5/summary/');
  });

  it('avisa del límite de uso', async () => {
    api.post.mockRejectedValue({ response: { status: 429 } });
    render(<AISummaryCard patientId={9} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generar resumen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('límite de resúmenes');
  });

  it('no aparece si el paciente no tiene tratamiento activo', async () => {
    api.get.mockImplementation(async () => ({ data: page([]) }));
    const { container } = render(<AISummaryCard patientId={9} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});

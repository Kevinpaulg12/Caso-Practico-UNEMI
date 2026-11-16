import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeries } from '../../services/evolution';
import PainChart from './PainChart';
import { PainByDayChart, SymptomChart } from './ReportCharts';

const report = (id, day, pain, color) => ({ id, pain_level: pain, postoperative_day: day, alert_color: color, created_at: '2026-11-02T10:00:00Z' });
const series = buildSeries([report(1, 0, 7, 'amarillo'), report(2, 1, 5, 'verde'), report(3, 3, 8, 'rojo')], [6, 5, 3, 2]);

// jsdom no calcula tamaños: se simula un contenedor de 600 px para que D3 dibuje.
let original;
beforeAll(() => {
  original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
});
afterAll(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
  else delete HTMLElement.prototype.clientWidth;
});

const svgOf = (container) => container.querySelector('svg[role=img]');

describe('PainChart (D3)', () => {
  it('D3 dibuja las dos curvas, el eje y un punto por día reportado coloreado por nivel', async () => {
    const { container } = render(<PainChart series={series} ariaLabel="EVA." />);
    await waitFor(() => expect(svgOf(container).querySelectorAll('path.series')).toHaveLength(2));
    const svg = svgOf(container);
    expect(svg.getAttribute('width')).toBe('600');
    expect([...svg.querySelectorAll('g.dots[data-key=reported] circle')].map((dot) => dot.getAttribute('fill')))
      .toEqual(['#f59e0b', '#059669', '#e11d48']);
    expect(svg.querySelector('path.series[data-key=expected]').getAttribute('stroke-dasharray')).toBe('5 4');
    expect([...svg.querySelectorAll('g.y-grid text')].map((text) => text.textContent)).toEqual(['0', '2', '4', '6', '8', '10']);
    expect([...svg.querySelectorAll('text.end-label')].map((text) => text.textContent)).toEqual(['Esperado', 'Reportado']);
    expect(screen.getByText('Punto:')).toBeInTheDocument();
  });

  it('se recorre con el teclado: tooltip del día, retícula y punto resaltado', async () => {
    const { container } = render(<PainChart series={series} ariaLabel="EVA." />);
    const chart = screen.getByRole('img', { name: /flechas/ });
    await waitFor(() => expect(chart.querySelectorAll('circle').length).toBeGreaterThan(0));
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText('Día 0')).toBeInTheDocument();
    expect(screen.getByText(/EVA máx\. 7 · 1 reporte/)).toBeInTheDocument();
    expect(svgOf(container).querySelector('line.crosshair').getAttribute('visibility')).toBe('visible');
    expect(svgOf(container).querySelector('g.dots[data-key=reported] circle.is-active').getAttribute('data-day')).toBe('0');
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByText('Día 3')).toBeInTheDocument();
    fireEvent.blur(chart);
    expect(screen.queryByText('Día 3')).toBeNull();
    expect(svgOf(container).querySelector('line.crosshair').getAttribute('visibility')).toBe('hidden');
  });

  it('solo la curva esperada (catálogo): sin leyenda doble ni etiquetas finales', async () => {
    const { container } = render(<PainChart series={buildSeries([], [7, 5, 2])} showReported={false} ariaLabel="Curva." />);
    await waitFor(() => expect(svgOf(container).querySelectorAll('path.series')).toHaveLength(1));
    expect(svgOf(container).querySelectorAll('g.dots[data-key=expected] circle')).toHaveLength(3);
    expect(svgOf(container).querySelectorAll('text.end-label')).toHaveLength(0);
    expect(screen.queryByText(/Reportado/)).toBeNull();
  });

  it('al cambiar los datos D3 actualiza los puntos sin duplicar el SVG', async () => {
    const { container, rerender } = render(<PainChart series={buildSeries([], [7, 5])} showReported={false} ariaLabel="Curva." />);
    await waitFor(() => expect(svgOf(container).querySelectorAll('circle')).toHaveLength(2));
    rerender(<PainChart series={buildSeries([], [7, 5, 3, 1])} showReported={false} ariaLabel="Curva." />);
    await waitFor(() => expect(svgOf(container).querySelectorAll('circle')).toHaveLength(4));
    expect(svgOf(container).querySelectorAll('g.chart-root')).toHaveLength(1);
  });
});

describe('Gráficas del informe (D3)', () => {
  it('EVA promedio con la línea de umbral y los días que la superan en rojo', async () => {
    const data = [{ day: 0, average: 6.8, reports: 6 }, { day: 1, average: 7.4, reports: 4 }, { day: 3, average: 2.1, reports: 3 }];
    const { container } = render(<PainByDayChart data={data} threshold={7} />);
    await waitFor(() => expect(svgOf(container).querySelector('line.threshold')).not.toBeNull());
    expect(svgOf(container).querySelector('line.threshold').getAttribute('stroke')).toBe('#e11d48');
    expect([...svgOf(container).querySelectorAll('circle')].map((dot) => dot.getAttribute('fill')))
      .toEqual(['#2563eb', '#e11d48', '#2563eb']);
    const chart = screen.getByRole('img', { name: /EVA promedio/ });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(screen.getByText('Supera el umbral de riesgo alto')).toBeInTheDocument();
    // La tabla equivalente lleva los mismos datos.
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('signos de alarma: una barra por síntoma con su valor y etiqueta', async () => {
    const data = [{ label: 'Sangrado', count: 9 }, { label: 'Fiebre', count: 4 }];
    const { container } = render(<SymptomChart data={data} />);
    expect(screen.getByRole('img', { name: 'Sangrado: 9; Fiebre: 4' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('rect.bar')).toHaveLength(2));
    expect([...container.querySelectorAll('text.label')].map((text) => text.textContent)).toEqual(['Sangrado', 'Fiebre']);
    expect([...container.querySelectorAll('text.value')].map((text) => text.textContent)).toEqual(['9', '4']);
  });
});

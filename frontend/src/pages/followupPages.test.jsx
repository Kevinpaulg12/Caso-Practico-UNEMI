import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { renderAt } from '../test/utils';
import AdminAI from './AdminAI';

vi.mock('../services/api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));

describe('Métricas de IA', () => {
  beforeEach(() => api.get.mockReset());

  it('muestra el uso por función y la tasa de alternativa local', async () => {
    api.get.mockImplementation(async (url) => (url === '/me/' ? { data: {} } : {
      data: {
        enabled: true, model: 'gemini-2.5-flash', days: 30,
        features: [{ feature: 'assistant', label: 'Asistente conversacional', total: 10, llm: 8, fallback_rate: 20,
          avg_latency_ms: 1200, input_tokens: 4000, output_tokens: 500, cache_read_tokens: 12000 }],
        errors: [{ error: 'Tiempo de espera agotado', total: 2 }],
      },
    }));
    renderAt(<AdminAI />);
    expect(await screen.findByText('Asistente conversacional')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
    expect(screen.getByText('75 %')).toBeInTheDocument();
    expect(screen.getByText(/Tiempo de espera agotado/)).toBeInTheDocument();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setClinicClock, today } from './consultationRules';

// PF22: 2026-11-19 22:01 en Ecuador (America/Guayaquil, UTC-5) = 2026-11-20 03:01 UTC.
const NOW = new Date('2026-11-20T03:01:00Z');
const CLINIC = { clinic_timezone: 'America/Guayaquil', clinic_today: '2026-11-19' };

describe('today() sigue la fecha del consultorio', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    // Navegador en una zona horaria adelantada respecto al consultorio.
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
    setClinicClock(null);
  });

  it('sin datos del servidor usa la fecha del navegador (ya es 20 en UTC)', () => {
    expect(today()).toBe('2026-11-20');
  });

  it('con la zona horaria del consultorio devuelve su fecha local', () => {
    setClinicClock(CLINIC);
    expect(today()).toBe('2026-11-19');
  });

  it('también con un navegador en Asia, varias horas adelantado', () => {
    process.env.TZ = 'Asia/Tokyo';
    setClinicClock(CLINIC);
    expect(today()).toBe('2026-11-19');
  });

  it('avanza al día siguiente cuando llega la medianoche del consultorio', () => {
    setClinicClock(CLINIC);
    vi.setSystemTime(new Date('2026-11-20T05:00:00Z'));
    expect(today()).toBe('2026-11-20');
  });

  it('si la zona horaria no es válida usa la fecha que informó el servidor', () => {
    setClinicClock({ clinic_timezone: 'Marte/Olympus', clinic_today: '2026-11-19' });
    expect(today()).toBe('2026-11-19');
    vi.setSystemTime(new Date(NOW.getTime() + 86400000));
    expect(today()).toBe('2026-11-20');
  });
});

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderAt } from '../test/utils';
import AccountMenu from './AccountMenu';

const logout = vi.hoisted(() => vi.fn());
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout }) }));

const initials = () => screen.getByRole('button').querySelector('span').textContent;

describe('AccountMenu', () => {
  it('abre, cierra con Escape y con clic fuera', () => {
    renderAt(<AccountMenu user={{ username: 'u', full_name: 'Ana Ruiz' }} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.getByText('Mi perfil')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Mi perfil')).toBeNull();
    fireEvent.click(button);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Mi perfil')).toBeNull();
  });

  it('cierra sesión', () => {
    renderAt(<AccountMenu user={{ username: 'u' }} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Cerrar sesión'));
    expect(logout).toHaveBeenCalled();
  });

  it('funciona sin usuario todavía cargado', () => {
    renderAt(<AccountMenu user={null} />);
    expect(screen.getAllByText('Mi cuenta')).not.toHaveLength(0);
  });

  it('BUG-46 "Carlos Pérez" muestra CP', () => {
    renderAt(<AccountMenu user={{ full_name: 'Carlos Pérez' }} />);
    expect(initials()).toBe('CP');
  });

  it('BUG-46 un nombre con emoji no produce un carácter roto', () => {
    renderAt(<AccountMenu user={{ full_name: '🦊 Fox' }} />);
    expect(initials()).toBe('🦊F');
  });
});

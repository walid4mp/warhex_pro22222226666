// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from './App';
import './i18n';

describe('web app', () => {
  it('renders landing page when logged out', () => {
    localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/رويال سكوير/i)).toBeInTheDocument();
    expect(screen.getByText(/ابدأ الآن/i)).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from '../../src/app/App';

test('runs under jsdom and renders the app heading', () => {
  expect(typeof document).not.toBe('undefined');
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Code Atlas' })).toBeTruthy();
});

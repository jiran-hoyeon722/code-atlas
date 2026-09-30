import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleApp } from './BattleApp';
import { defaultDeps } from './deps';
import './theme.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BattleApp deps={defaultDeps()} />
  </StrictMode>,
);

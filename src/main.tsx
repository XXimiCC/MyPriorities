import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { StoreProvider } from './store/useStore';
import { initTelegram } from './telegram/sdk';
import './styles/global.css';

// До первого рендера: клиент должен успеть перекрасить шапку и отдать безопасные зоны.
initTelegram();

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент #root');

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

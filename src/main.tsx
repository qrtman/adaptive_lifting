import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SyncProvider } from './contexts/SyncContext';
import { AuthProvider } from './contexts/AuthContext';
import { PeriodizationProvider } from './contexts/PeriodizationContext';
import { migrateAndPurgeLegacyStorage } from './storage/uiPrefs';

migrateAndPurgeLegacyStorage();

// Register Service Worker for offline PWA capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('PWA ServiceWorker successfully registered:', reg.scope))
      .catch(err => console.error('PWA ServiceWorker registration failed:', err));
  });
}

createRoot(document.getElementById('root')!).render(

  <StrictMode>
    <AuthProvider>
      <PeriodizationProvider>
        <SyncProvider>
          <App />
        </SyncProvider>
      </PeriodizationProvider>
    </AuthProvider>
  </StrictMode>,
);

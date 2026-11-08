import { EmailVerificationView } from './components/EmailVerificationView';
import { PasswordResetView } from './components/PasswordResetView';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SyncProvider } from './contexts/SyncContext';
import { AuthProvider } from './contexts/AuthContext';
import { PeriodizationProvider } from './contexts/PeriodizationContext';
import { AccessProvider } from './contexts/AccessContext';
import { migrateAndPurgeLegacyStorage } from './storage/uiPrefs';
import { IS_FRESH_PRODUCTION_CLIENT } from './services/clientDataBoundary';
import { registerAppServiceWorker } from './services/serviceWorkerRegistration';

migrateAndPurgeLegacyStorage();

// Register Service Worker for offline PWA capabilities
if ('serviceWorker' in navigator) {
  registerAppServiceWorker(navigator.serviceWorker, window, IS_FRESH_PRODUCTION_CLIENT);
}

createRoot(document.getElementById('root')!).render(

  <StrictMode>
    {window.location.pathname === '/verify-email' ? <EmailVerificationView /> : window.location.pathname === '/reset-password' ? <PasswordResetView /> : <AuthProvider>
      <AccessProvider>
        <PeriodizationProvider>
          <SyncProvider>
            <App />
          </SyncProvider>
        </PeriodizationProvider>
      </AccessProvider>
    </AuthProvider>}
  </StrictMode>,
);

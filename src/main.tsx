import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SyncProvider } from './contexts/SyncContext';

// Register Service Worker for offline PWA capabilities (production only)
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('PWA ServiceWorker successfully registered:', reg.scope))
      .catch(err => console.error('PWA ServiceWorker registration failed:', err));
  });
}

// Dev: unregister any stale SW that cached broken Vite modules
if ('serviceWorker' in navigator && import.meta.env.DEV) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}

// @hyperide-managed
if (new URLSearchParams(location.search).get("component") && location.pathname.includes("test-preview")) {
  import("./__canvas_preview__").then(m => {
    var CanvasPreviewComp = m.default;

    if (CanvasPreviewComp)
      createRoot(document.getElementById("root")!).render(<CanvasPreviewComp />);
  }).catch(() => {});
} else {
  createRoot(document.getElementById('root')!).render(

    <StrictMode>
      <SyncProvider>
        <App />
      </SyncProvider>
    </StrictMode>,
  );
}

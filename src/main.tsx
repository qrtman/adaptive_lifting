import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SyncProvider } from './contexts/SyncContext';

// Register Service Worker for offline PWA capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('PWA ServiceWorker successfully registered:', reg.scope))
      .catch(err => console.error('PWA ServiceWorker registration failed:', err));
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

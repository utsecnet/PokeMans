import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Custom scroll restoration (see lib/scrollRestoration.ts) owns this instead — leaving
// the browser's own 'auto' behavior on for an SPA's pushState navigation is inconsistent
// across browsers and can fight the manual restore, causing a visible double-jump.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

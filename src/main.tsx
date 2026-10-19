import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyHostMarkup } from './platform/installHost'
import { getPlatform } from './platform'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './pwa/register'

applyHostMarkup(document, getPlatform().kind)
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

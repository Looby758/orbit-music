import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)

// Works offline, and can be added to the home screen.
if ('serviceWorker' in navigator && location.protocol === 'https:') void navigator.serviceWorker.register('./sw.js').catch(() => undefined)

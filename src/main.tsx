import { createRoot } from 'react-dom/client'
import App from './App'
import './gameTheme.css'
import './propertyCards.css'
import './styles.css'

// No StrictMode on purpose: it mounts effects twice in dev, which makes PeerJS
// try to register the same host peer id twice and fail with "unavailable-id".
const container = document.getElementById('root')
if (!container) throw new Error('Falta el nodo #root')

createRoot(container).render(<App />)

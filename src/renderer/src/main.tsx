import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installWebApi } from './web-api'
import './styles.css'

if (!window.aram) installWebApi()

createRoot(document.getElementById('root')!).render(<App />)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { BlendTest } from './ui/BlendTest'
import './ui/styles.css'

if (import.meta.env.DEV) void import('./debug')

const page = new URLSearchParams(location.search).get('test') === 'blend' ? <BlendTest /> : <App />
createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BlendTest } from './ui/BlendTest'
import { Editor } from './ui/Editor'
import './ui/styles.css'

const page = new URLSearchParams(location.search).get('test') === 'blend' ? <BlendTest /> : <Editor />
createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { G3 } from './g3/G3'
import { BlendTest } from './ui/BlendTest'
import './ui/styles.css'

if (import.meta.env.DEV) void import('./debug')

const params = new URLSearchParams(location.search)
const g3 = params.get('g3')
const page = params.get('test') === 'blend' ? <BlendTest /> : g3 !== null ? <G3 page={g3} /> : <App />
const titles: Record<string, string> = { survey: '问卷', observe: '观察记录', results: '汇总' }
if (params.get('test') === 'blend') document.title = 'ArtPS · 渲染自检'
else if (g3 !== null) document.title = `ArtPS · ${titles[g3] ?? '用户测试'}`
createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>)

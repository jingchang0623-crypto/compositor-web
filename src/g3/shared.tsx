// Pieces the G3 pages share: drafts kept in the browser, file download, and a little about the tester's setup.

export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null // Private windows and blocked storage: start fresh.
  }
}

export function saveDraft(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Not kept; the page still works. */ }
}

export function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Browser, system, screen and GPU, for telling setup problems from design ones. Nothing that identifies a person. */
export function environment(): Record<string, string> {
  const ua = navigator.userAgent
  const browser = /Edg\/([\d.]+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
    : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`
    : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
    : /Version\/([\d.]+).*Safari/.exec(ua) ? `Safari ${/Version\/([\d.]+)/.exec(ua)![1]}` : 'other'
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : 'other'
  let gpu = 'unknown'
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    gpu = gl ? String(gl.getParameter(gl.RENDERER)) : 'no WebGL2'
  } catch { /* keep unknown */ }
  return { browser, os, screen: `${screen.width}×${screen.height} @${devicePixelRatio}x`, gpu }
}

/** The participant code from the link (?p=P03), normalized. */
export function participantFromURL(): string {
  return (new URLSearchParams(location.search).get('p') ?? '').trim().toUpperCase()
}

export const base = import.meta.env.BASE_URL

/** Today as YYYY-MM-DD in the local time zone (toISOString would give the UTC date). */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

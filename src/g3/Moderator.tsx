// What the G3 moderator uses: an observation sheet per session (timers, help given, incidents), and the results page
// that reads every session's files and gives the verdict against GOALS.md.

import { useEffect, useRef, useState } from 'react'
import { SECTIONS, TASKS } from './questions'
import { ASSIST_LEVELS, REQUIRED, independent, summarize, sus, type Light, type ObservationFile, type Participant, type SurveyFile, type TaskResult } from './scoring'
import { base, downloadJSON, loadDraft, saveDraft, today } from './shared'

function ModeratorNav({ at }: { at: 'observe' | 'results' }) {
  return (
    <nav className="g3-nav">
      <a href={`${base}?g3=task`}>任务卡</a>
      <a href={`${base}?g3=survey`}>问卷</a>
      <a href={`${base}?g3=observe`} aria-current={at === 'observe'}>观察记录</a>
      <a href={`${base}?g3=results`} aria-current={at === 'results'}>汇总</a>
    </nav>
  )
}

// MARK: Observation sheet

type Sheet = Omit<ObservationFile, 'kind' | 'version'>
type Timers = Record<string, number | null>

const blankSheet = (participant: string): Sheet => ({
  participant, date: today(), moderator: '', device: '',
  tasks: Object.fromEntries(TASKS.map((t) => [t.id, { result: (t.optional ? 'skipped' : 'failed') as TaskResult, assist: 0 as const, seconds: 0, notes: '' }])),
  incidents: [], quotes: '',
})

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function Observe() {
  const [participant, setParticipant] = useState(() => new URLSearchParams(location.search).get('p')?.toUpperCase() ?? 'P01')
  const key = `g3-observation-${participant}`
  const [sheet, setSheet] = useState<Sheet>(() => loadDraft<Sheet>(key) ?? blankSheet(participant))
  const [running, setRunning] = useState<Timers>({})
  const [, tick] = useState(0)
  const started = useRef(Date.now())
  const [incident, setIncident] = useState('')

  useEffect(() => { setSheet(loadDraft<Sheet>(key) ?? blankSheet(participant)); setRunning({}) }, [key, participant])
  useEffect(() => { saveDraft(key, sheet) }, [key, sheet])
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t) }, [])

  const task = (id: string, patch: Partial<Sheet['tasks'][string]>) =>
    setSheet((s) => ({ ...s, tasks: { ...s.tasks, [id]: { ...s.tasks[id], ...patch } } }))
  const elapsed = (id: string) => sheet.tasks[id].seconds + (running[id] ? (Date.now() - running[id]!) / 1000 : 0)
  const toggle = (id: string) => {
    if (running[id]) { task(id, { seconds: Math.round(elapsed(id)) }); setRunning((r) => ({ ...r, [id]: null })) }
    else setRunning((r) => ({ ...r, [id]: Date.now() }))
  }
  const addIncident = () => {
    if (!incident.trim()) return
    setSheet((s) => ({ ...s, incidents: [...s.incidents, { at: clock((Date.now() - started.current) / 1000), note: incident.trim() }] }))
    setIncident('')
  }
  const exportSheet = () => {
    // Timers still going stop at the moment of export.
    const tasks = Object.fromEntries(Object.entries(sheet.tasks).map(([id, t]) => [id, { ...t, seconds: Math.round(elapsed(id)) }]))
    downloadJSON({ kind: 'artps-g3-observation', version: 1, ...sheet, tasks } satisfies ObservationFile, `${participant}-observation.json`)
  }
  const ok = independent({ id: participant, observation: { kind: 'artps-g3-observation', version: 1, ...sheet } })

  return (
    <main className="g3 wide">
      <ModeratorNav at="observe" />
      <header className="g3-head">
        <span className="kicker">主持人 · 观察记录</span>
        <h1>{participant}</h1>
        <p>每项任务开始时按计时，结束时再按一次。“独立完成” = 三个必做任务都完成，且最多只有 1 级帮助（中性追问）。</p>
      </header>

      <section className="g3-card g3-grid">
        <label>编号 <input value={participant} onChange={(e) => setParticipant(e.target.value.trim().toUpperCase())} /></label>
        <label>日期 <input type="date" value={sheet.date} onChange={(e) => setSheet({ ...sheet, date: e.target.value })} /></label>
        <label>主持人 <input value={sheet.moderator ?? ''} onChange={(e) => setSheet({ ...sheet, moderator: e.target.value })} /></label>
        <label>设备 / 浏览器 <input value={sheet.device ?? ''} placeholder="MacBook Air · Chrome" onChange={(e) => setSheet({ ...sheet, device: e.target.value })} /></label>
      </section>

      {TASKS.map((t) => {
        const r = sheet.tasks[t.id]
        return (
          <section className="g3-card" key={t.id}>
            <div className="g3-task-head">
              <h2>{t.id} · {t.title}{t.optional && <span className="note">（可选）</span>}</h2>
              <button className={running[t.id] ? 'primary' : ''} onClick={() => toggle(t.id)}>
                {running[t.id] ? '停止' : '计时'} {clock(elapsed(t.id))}
              </button>
            </div>
            <p className="note">给参与者的目标：{t.goal}</p>
            <p className="note">算完成：{t.done}</p>
            <div className="g3-grid">
              <label>结果
                <select value={r.result} onChange={(e) => task(t.id, { result: e.target.value as TaskResult })}>
                  <option value="done">完成</option><option value="partial">部分完成</option><option value="failed">没完成</option>
                  {t.optional && <option value="skipped">没尝试</option>}
                </select>
              </label>
              <label>给过的最高帮助
                <select value={r.assist} onChange={(e) => task(t.id, { assist: Number(e.target.value) as 0 | 1 | 2 | 3 })}>
                  {ASSIST_LEVELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                </select>
              </label>
            </div>
            <textarea rows={2} placeholder="参与者怎么做的、在哪里犹豫、用了哪些功能" value={r.notes} onChange={(e) => task(t.id, { notes: e.target.value })} />
          </section>
        )
      })}

      <section className="g3-card">
        <h2>关键事件</h2>
        <div className="g3-incident">
          <input value={incident} placeholder="比如：在工具栏找魔棒，找了 40 秒" onChange={(e) => setIncident(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addIncident() }} />
          <button onClick={addIncident}>记下（带时间）</button>
        </div>
        <ul className="g3-incidents">{sheet.incidents.map((i, n) => <li key={n}><code>{i.at}</code> {i.note}</li>)}</ul>
        <h2>原话</h2>
        <textarea rows={4} placeholder="参与者说过的、值得原样记下的话" value={sheet.quotes} onChange={(e) => setSheet({ ...sheet, quotes: e.target.value })} />
      </section>

      <footer className="g3-submit">
        <span className={ok ? 'pass' : 'note'}>{ok ? '独立完成' : '尚未独立完成'}（按当前记录）</span>
        <button className="primary" onClick={exportSheet}>导出 {participant}-observation.json</button>
      </footer>
    </main>
  )
}

// MARK: Results

const LIGHTS: Record<Light, string> = { green: '🟢 绿灯', yellow: '🟡 黄灯', red: '🔴 红灯' }
const label = (qid: string, value: string) => {
  const q = SECTIONS.flatMap((s) => s.questions).find((x) => x.id === qid)
  return q && 'options' in q ? q.options.find((o) => o.value === value)?.label ?? value : value
}
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

export function Results() {
  const [people, setPeople] = useState<Participant[]>([])
  const [problems, setProblems] = useState<string[]>([])

  const read = async (files: FileList | File[]) => {
    const byID = new Map(people.map((p) => [p.id, { ...p }]))
    const bad: string[] = []
    for (const f of Array.from(files)) {
      try {
        const data = JSON.parse(await f.text()) as SurveyFile | ObservationFile
        const id = data.participant?.toUpperCase()
        if (!id || (data.kind !== 'artps-g3-survey' && data.kind !== 'artps-g3-observation')) throw new Error('不是 G3 的结果文件')
        const p = byID.get(id) ?? { id }
        if (data.kind === 'artps-g3-survey') p.survey = data
        else p.observation = data
        byID.set(id, p)
      } catch (e) {
        bad.push(`${f.name}：${e instanceof Error ? e.message : e}`)
      }
    }
    setPeople([...byID.values()].sort((a, b) => a.id.localeCompare(b.id)))
    setProblems(bad)
  }

  const s = summarize(people)
  const markdown = () => [
    `### G3 结果（${today()}，${s.n} 人）`,
    '',
    `- 结论：${s.decision.light ? LIGHTS[s.decision.light] : '—'} · ${s.decision.reason}`,
    `- G3.2 独立完成率：${pct(s.completionRate)}（${s.completed} 人，通过线 70%）`,
    `- G3.3 三色灯：绿 ${s.lights.green} · 黄 ${s.lights.yellow} · 红 ${s.lights.red}`,
    `- SUS 平均 ${s.susMean?.toFixed(1) ?? '—'}（行业平均约 68）· NPS ${s.npsScore ?? '—'}`,
    `- 各任务完成：${TASKS.map((t) => `${t.title} ${s.perTask[t.id].done}/${s.perTask[t.id].of}`).join(' · ')}`,
    `- 最先要补：${s.missing.slice(0, 5).map(([v, n]) => `${label('missing', v)} ${n}`).join(' · ') || '—'}`,
    `- 每月愿付：${Object.entries(s.pay).map(([v, n]) => `${label('pay_month', v)} ${n}`).join(' · ') || '—'}`,
  ].join('\n')

  return (
    <main className="g3 wide">
      <ModeratorNav at="results" />
      <header className="g3-head">
        <span className="kicker">主持人 · 汇总</span>
        <h1>G3 结果</h1>
        <p>把所有参与者的 <code>-survey.json</code> 和 <code>-observation.json</code> 一起拖进来（同一编号会自动合并）。文件只在这台电脑上读取。</p>
      </header>

      <label className="g3-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void read(e.dataTransfer.files) }}>
        <input type="file" accept=".json,application/json" multiple onChange={(e) => e.target.files && void read(e.target.files)} />
        <span>拖入结果文件，或点击选择</span>
      </label>
      {problems.length > 0 && <ul className="fail">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

      {people.length > 0 && (
        <>
          <section className={`g3-verdict ${s.decision.light ?? 'none'}`}>
            <strong>{s.decision.light ? LIGHTS[s.decision.light] : '还不能下结论'}</strong>
            <span>{s.decision.reason}</span>
          </section>

          <section className="g3-metrics">
            <div><span>G3.2 独立完成率</span><strong className={s.completionRate !== null && s.completionRate >= 0.7 ? 'pass' : 'fail'}>{pct(s.completionRate)}</strong><em>{s.completed} / {s.n} 人 · 通过线 70%</em></div>
            <div><span>G3.3 三色灯</span><strong>{s.lights.green} · {s.lights.yellow} · {s.lights.red}</strong><em>绿 · 黄 · 红</em></div>
            <div><span>SUS</span><strong>{s.susMean?.toFixed(1) ?? '—'}</strong><em>行业平均约 68</em></div>
            <div><span>NPS</span><strong>{s.npsScore ?? '—'}</strong><em>推荐者 − 贬损者</em></div>
          </section>

          <section className="g3-card">
            <h2>每个人</h2>
            <table className="g3-table">
              <thead><tr><th>编号</th>{REQUIRED.map((t) => <th key={t}>{TASKS.find((x) => x.id === t)!.title}</th>)}<th>独立完成</th><th>三色灯</th><th>SUS</th><th>浏览器</th></tr></thead>
              <tbody>
                {people.map((p) => {
                  const ok = independent(p)
                  return (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      {REQUIRED.map((t) => {
                        const o = p.observation?.tasks[t]
                        const r = o?.result ?? (p.survey?.answers[`self_${t}`] as string | undefined)
                        return <td key={t}>{r === 'done' ? '✓' : r === 'partial' ? '半' : r ? '✗' : '—'}{o && ` · 帮助 ${o.assist} · ${clock(o.seconds)}`}</td>
                      })}
                      <td className={ok ? 'pass' : 'fail'}>{ok === null ? '—' : ok ? '是' : '否'}</td>
                      <td>{p.survey?.answers.light ? LIGHTS[p.survey.answers.light as Light] : '—'}</td>
                      <td>{p.survey ? sus(p.survey.answers) ?? '—' : '—'}</td>
                      <td>{p.survey?.env.browser ?? p.observation?.device ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="note">有观察记录时，以主持人的记录判断“独立完成”；只有问卷时，看参与者自评（完成且没有求助）。</p>
          </section>

          <section className="g3-card">
            <h2>最先要补的功能</h2>
            <ul className="g3-bars">
              {s.missing.map(([v, n]) => (
                <li key={v}><span>{label('missing', v)}</span><span className="bar" style={{ width: `${(n / Math.max(1, s.n)) * 100}%` }} /><em>{n}</em></li>
              ))}
            </ul>
            <h2>每月最多愿付</h2>
            <ul className="g3-bars">
              {Object.entries(s.pay).map(([v, n]) => (
                <li key={v}><span>{label('pay_month', v)}</span><span className="bar" style={{ width: `${(n / Math.max(1, s.n)) * 100}%` }} /><em>{n}</em></li>
              ))}
            </ul>
            <h2>任务难度（SEQ，1–7，越高越容易）</h2>
            <p>{TASKS.filter((t) => !t.optional).map((t) => `${t.title} ${s.seqMean[t.id]?.toFixed(1) ?? '—'}`).join(' · ')}</p>
          </section>

          <section className="g3-card">
            <h2>他们说的</h2>
            {people.map((p) => {
              const a = p.survey?.answers ?? {}
              const lines = [
                ['最卡的地方', a.stuck], ['为什么这么选', a.light_why], ['还缺', a.missing_other], ['还想说', a.anything], ['原话（主持人记录）', p.observation?.quotes],
              ].filter(([, v]) => typeof v === 'string' && v.trim())
              if (!lines.length && !p.observation?.incidents.length) return null
              return (
                <div key={p.id} className="g3-voice">
                  <strong>{p.id}</strong>
                  {lines.map(([k, v]) => <p key={k as string}><em>{k}：</em>{v as string}</p>)}
                  {p.observation?.incidents.map((i, n) => <p key={n}><code>{i.at}</code> {i.note}</p>)}
                </div>
              )
            })}
          </section>

          <footer className="g3-submit">
            <button onClick={() => void navigator.clipboard?.writeText(markdown())}>复制 Markdown 摘要（贴进 GOALS.md）</button>
          </footer>
        </>
      )}
    </main>
  )
}

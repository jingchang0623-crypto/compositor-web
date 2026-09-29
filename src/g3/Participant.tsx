// What a G3 participant sees: the task card (materials and goals, never steps) and the questionnaire.

import { useEffect, useMemo, useState } from 'react'
import { SECTIONS, TASKS, type Question } from './questions'
import type { Answer, SurveyFile } from './scoring'
import { base, downloadJSON, environment, loadDraft, participantFromURL, saveDraft } from './shared'

// MARK: Task card

export function TaskCard() {
  const p = participantFromURL()
  const survey = `${base}?g3=survey${p ? `&p=${encodeURIComponent(p)}` : ''}`
  return (
    <main className="g3">
      <header className="g3-head">
        <span className="kicker">Compositor 网页版 · 用户测试{p && ` · ${p}`}</span>
        <h1>换一片天空</h1>
        <p>这是一个浏览器里的分层合成工具，还在早期阶段。请你用它完成下面几件事，大约 25 分钟。我们测的是工具，不是你：
          卡住的地方正是我们最想知道的。</p>
      </header>

      <section className="g3-card">
        <h2>开始之前</h2>
        <ul>
          <li>用电脑（Mac 或 Windows），最新版的 Chrome、Edge 或 Safari，鼠标或触控板都可以。</li>
          <li>如果有主持人在线，请边做边说出你在想什么、在找什么。</li>
          <li>图片只在你的电脑上处理，不会上传。部分 Photoshop 功能还没有，这是正常的。</li>
        </ul>
      </section>

      <section className="g3-card">
        <h2>素材</h2>
        <div className="g3-actions">
          <a className="button primary" href={`${base}?open=${encodeURIComponent('g3/街景.comp.zip')}`} target="_blank" rel="noreferrer">打开编辑器和街景 ↗</a>
          <a className="button" href={`${base}g3/sky.jpg`} download="sky.jpg">下载新天空 sky.jpg</a>
          <a className="button" href={`${base}g3/street.jpg`} download="street.jpg">街景原图（备用）</a>
        </div>
        <p className="note">第一个按钮会在新标签页里打开编辑器，并带着街景。晚霞图片下载后，按你习惯的方式放进去。</p>
        <div className="g3-preview">
          <figure><img src={`${base}g3/street.jpg`} alt="阴天的街景：灰色天空下的一排楼和树" /><figcaption>现在：阴天</figcaption></figure>
          <figure><img src={`${base}g3/sky.jpg`} alt="晚霞：从深紫到橙黄的天空" /><figcaption>要换成：晚霞</figcaption></figure>
        </div>
      </section>

      <section className="g3-card">
        <h2>任务</h2>
        <ol className="g3-tasks">
          {TASKS.map((t) => (
            <li key={t.id}>
              <strong>{t.title}</strong>
              <span>{t.goal}</span>
            </li>
          ))}
        </ol>
        <p className="note">不用追求完美，做到你觉得“可以交了”就行。做不下去也没关系，告诉我们卡在哪。</p>
      </section>

      <section className="g3-card">
        <h2>做完之后</h2>
        <p>填一份 5 分钟的问卷。</p>
        <a className="button primary" href={survey}>去填问卷</a>
      </section>
    </main>
  )
}

// MARK: Questionnaire

type Answers = Record<string, Answer>

function answered(v: Answer | undefined) {
  if (v === undefined) return false
  if (Array.isArray(v)) return v.length > 0
  return typeof v === 'number' || v.trim().length > 0
}

export function Survey() {
  const [participant, setParticipant] = useState(participantFromURL())
  const draftKey = `g3-survey-${participant || 'anon'}`
  const [answers, setAnswers] = useState<Answers>(() => loadDraft<Answers>(draftKey) ?? {})
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [submitted, setSubmitted] = useState<SurveyFile | null>(null)

  useEffect(() => { saveDraft(draftKey, answers) }, [draftKey, answers])
  const required = useMemo(() => SECTIONS.flatMap((s) => s.questions).filter((q) => !q.optional), [])
  const progress = required.filter((q) => answered(answers[q.id])).length

  const set = (id: string, v: Answer) => {
    setAnswers((a) => ({ ...a, [id]: v }))
    setMissing((m) => { const n = new Set(m); n.delete(id); return n })
  }

  const submit = () => {
    const gaps = required.filter((q) => !answered(answers[q.id])).map((q) => q.id)
    if (!participant) gaps.unshift('participant')
    if (gaps.length) {
      setMissing(new Set(gaps))
      document.getElementById(`q-${gaps[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const file: SurveyFile = {
      kind: 'compositor-g3-survey', version: 1, participant, submittedAt: new Date().toISOString(), env: environment(), answers,
    }
    downloadJSON(file, `${participant}-survey.json`)
    setSubmitted(file)
  }

  if (submitted) {
    return (
      <main className="g3">
        <header className="g3-head">
          <span className="kicker">用户测试 · {submitted.participant}</span>
          <h1>谢谢你！</h1>
          <p>结果文件 <code>{submitted.participant}-survey.json</code> 已经下载。请把它和导出的 JPEG 一起发给主持人。</p>
        </header>
        <section className="g3-card">
          <div className="g3-actions">
            <button className="primary" onClick={() => downloadJSON(submitted, `${submitted.participant}-survey.json`)}>再下载一次</button>
            <button onClick={() => void navigator.clipboard?.writeText(JSON.stringify(submitted))}>复制结果（可直接粘贴发送）</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="g3">
      <header className="g3-head">
        <span className="kicker">Compositor 网页版 · 用户测试问卷</span>
        <h1>刚才用得怎么样？</h1>
        <p>大约 5 分钟。结果会附带你的浏览器、系统和屏幕尺寸，用来排查问题，不包含任何个人信息。</p>
      </header>

      <section className="g3-card" id="q-participant">
        <label className={`g3-q${missing.has('participant') ? ' missing' : ''}`}>
          <span className="g3-q-text">你的测试编号（主持人给你的，比如 P03）</span>
          <input value={participant} onChange={(e) => setParticipant(e.target.value.trim().toUpperCase())} placeholder="P01" />
        </label>
      </section>

      {SECTIONS.map((section) => (
        <section className="g3-card" key={section.id}>
          <h2>{section.title}</h2>
          {section.intro && <p className="note">{section.intro}</p>}
          {section.questions.map((q) => (
            <QuestionField key={q.id} q={q} value={answers[q.id]} missing={missing.has(q.id)} onChange={(v) => set(q.id, v)} />
          ))}
        </section>
      ))}

      <footer className="g3-submit">
        <span className="note">已答 {progress} / {required.length} 道必答题</span>
        {missing.size > 0 && <span className="fail">还有 {missing.size} 道没答</span>}
        <button className="primary" onClick={submit}>提交并下载结果</button>
      </footer>
    </main>
  )
}

function QuestionField({ q, value, missing, onChange }: { q: Question; value: Answer | undefined; missing: boolean; onChange: (v: Answer) => void }) {
  return (
    <fieldset className={`g3-q${missing ? ' missing' : ''}`} id={`q-${q.id}`}>
      <legend className="g3-q-text">
        {q.text}
        {q.type === 'multi' && <span className="note">（{q.max ? `最多选 ${q.max} 个` : '可多选'}）</span>}
        {q.optional && <span className="note">（可不答）</span>}
      </legend>
      {q.type === 'single' && (
        <div className="g3-options">
          {q.options.map((o) => (
            <label key={o.value} className={value === o.value ? 'on' : ''}>
              <input type="radio" name={q.id} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
            </label>
          ))}
        </div>
      )}
      {q.type === 'multi' && (() => {
        const chosen = Array.isArray(value) ? value : []
        const full = q.max !== undefined && chosen.length >= q.max
        return (
          <div className="g3-options">
            {q.options.map((o) => {
              const on = chosen.includes(o.value)
              return (
                <label key={o.value} className={on ? 'on' : full ? 'dim' : ''}>
                  <input type="checkbox" checked={on} disabled={!on && full}
                    onChange={() => onChange(on ? chosen.filter((c) => c !== o.value) : [...chosen, o.value])} /> {o.label}
                </label>
              )
            })}
          </div>
        )
      })()}
      {q.type === 'scale' && (
        <div className="g3-scale" role="radiogroup" aria-label={q.text}>
          <span className="end">{q.minLabel}</span>
          {Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).map((n) => (
            <button key={n} role="radio" aria-checked={value === n} className={value === n ? 'on' : ''} onClick={() => onChange(n)}>{n}</button>
          ))}
          <span className="end">{q.maxLabel}</span>
        </div>
      )}
      {q.type === 'text' && (
        <textarea rows={3} value={typeof value === 'string' ? value : ''} placeholder={q.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </fieldset>
  )
}

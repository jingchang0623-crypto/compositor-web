// Turning G3 sessions into the numbers GOALS.md asks for: how many completed the task on their own (G3.2, pass line
// 70%), how the traffic light fell (G3.3), and the usual usability scores alongside.

import { SUS_ITEMS, TASKS } from './questions'

export type Answer = string | string[] | number

export interface SurveyFile {
  kind: 'compositor-g3-survey'
  version: 1
  participant: string
  submittedAt: string
  env: Record<string, string>
  answers: Record<string, Answer>
}

export type TaskResult = 'done' | 'partial' | 'failed' | 'skipped'

export interface ObservationFile {
  kind: 'compositor-g3-observation'
  version: 1
  participant: string
  date: string
  moderator?: string
  device?: string
  tasks: Record<string, { result: TaskResult; assist: 0 | 1 | 2 | 3; seconds: number; notes: string }>
  incidents: { at: string; note: string }[]
  quotes: string
}

/** Moderator help: 0 none, 1 a neutral prompt ("what are you trying to do?"), 2 a hint, 3 showed how. */
export const ASSIST_LEVELS = ['0 · 没有帮助', '1 · 中性追问（“你现在想做什么？”）', '2 · 给了提示（指向某个区域或功能）', '3 · 直接告诉 / 演示怎么做']

/** Only the three required tasks decide completion. */
export const REQUIRED = TASKS.filter((t) => !t.optional).map((t) => t.id)

/** System Usability Scale, 0–100: odd items score (answer − 1), even (5 − answer), summed × 2.5. */
export function sus(answers: Record<string, Answer>): number | null {
  let sum = 0
  for (let i = 1; i <= SUS_ITEMS.length; i++) {
    const v = answers[`sus${i}`]
    if (typeof v !== 'number') return null
    sum += i % 2 ? v - 1 : 5 - v
  }
  return sum * 2.5
}

/** Net Promoter Score: % who answered 9–10 minus % who answered 0–6. */
export function nps(scores: number[]): number | null {
  if (!scores.length) return null
  const promoters = scores.filter((s) => s >= 9).length, detractors = scores.filter((s) => s <= 6).length
  return Math.round(((promoters - detractors) / scores.length) * 100)
}

export interface Participant {
  id: string
  survey?: SurveyFile
  observation?: ObservationFile
}

/**
 * Whether a participant completed every required task on their own. The moderator's sheet decides when there is one
 * (done, with at most a neutral prompt); otherwise the participant's own answers (done, and no help asked for).
 */
export function independent(p: Participant): boolean | null {
  if (p.observation) return REQUIRED.every((t) => p.observation!.tasks[t]?.result === 'done' && (p.observation!.tasks[t]?.assist ?? 3) <= 1)
  if (p.survey) return REQUIRED.every((t) => p.survey!.answers[`self_${t}`] === 'done') && p.survey.answers.asked_help === 'no'
  return null
}

export type Light = 'green' | 'yellow' | 'red'

export interface Summary {
  n: number
  completed: number
  completionRate: number | null
  perTask: Record<string, { done: number; of: number }>
  lights: Record<Light, number>
  susMean: number | null
  npsScore: number | null
  seqMean: Record<string, number | null>
  missing: [string, number][]
  pay: Record<string, number>
  decision: { light: Light | null; reason: string }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * The G3 verdict, by the rules written in docs/g3/README.md: green when at least 70% completed on their own and at
 * least half chose green; red when fewer than half completed or at least 40% chose red; yellow otherwise. Fewer than
 * five participants give no verdict.
 */
export function summarize(people: Participant[]): Summary {
  const n = people.length
  const judged = people.map(independent).filter((v): v is boolean => v !== null)
  const completed = judged.filter(Boolean).length
  const completionRate = judged.length ? completed / judged.length : null

  const perTask: Summary['perTask'] = {}
  for (const t of TASKS) {
    const results = people.map((p) => p.observation?.tasks[t.id]?.result ?? (p.survey?.answers[`self_${t.id}`] as string | undefined)).filter(Boolean)
    perTask[t.id] = { done: results.filter((r) => r === 'done').length, of: results.length }
  }

  const lights: Record<Light, number> = { green: 0, yellow: 0, red: 0 }
  for (const p of people) { const l = p.survey?.answers.light as Light | undefined; if (l && l in lights) lights[l]++ }
  const voted = lights.green + lights.yellow + lights.red

  const susScores = people.map((p) => (p.survey ? sus(p.survey.answers) : null)).filter((v): v is number => v !== null)
  const npsScores = people.map((p) => p.survey?.answers.nps).filter((v): v is number => typeof v === 'number')
  const seqMean: Summary['seqMean'] = {}
  for (const t of TASKS) seqMean[t.id] = mean(people.map((p) => p.survey?.answers[`seq_${t.id}`]).filter((v): v is number => typeof v === 'number'))

  const missingCount = new Map<string, number>()
  for (const p of people) for (const m of (p.survey?.answers.missing as string[] | undefined) ?? []) missingCount.set(m, (missingCount.get(m) ?? 0) + 1)
  const pay: Record<string, number> = {}
  for (const p of people) { const v = p.survey?.answers.pay_month as string | undefined; if (v) pay[v] = (pay[v] ?? 0) + 1 }

  let decision: Summary['decision']
  if (n < 5 || completionRate === null || !voted) {
    decision = { light: null, reason: `样本不足：需要至少 5 人的完整数据（现在 ${n} 人）` }
  } else if (completionRate < 0.5 || lights.red / voted >= 0.4) {
    decision = { light: 'red', reason: `独立完成率 ${(completionRate * 100).toFixed(0)}%，红灯 ${lights.red}/${voted}：重新评估 H2（这个方向值不值得做）` }
  } else if (completionRate >= 0.7 && lights.green / voted >= 0.5) {
    decision = { light: 'green', reason: `独立完成率 ${(completionRate * 100).toFixed(0)}% ≥ 70%，绿灯 ${lights.green}/${voted} ≥ 一半：进入 G4，按“最先要补的功能”排序` }
  } else {
    decision = { light: 'yellow', reason: `独立完成率 ${(completionRate * 100).toFixed(0)}%，绿灯 ${lights.green}/${voted}：先修最卡人的地方、换切口，再找一批新用户验证` }
  }

  return {
    n, completed, completionRate, perTask, lights,
    susMean: mean(susScores), npsScore: nps(npsScores), seqMean,
    missing: [...missingCount].sort((a, b) => b[1] - a[1]), pay, decision,
  }
}

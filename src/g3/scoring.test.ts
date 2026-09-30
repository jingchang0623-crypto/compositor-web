import { describe, expect, it } from 'vitest'
import { independent, nps, summarize, sus, type Participant, type SurveyFile } from './scoring'

const survey = (id: string, answers: SurveyFile['answers']): Participant => ({
  id, survey: { kind: 'artps-g3-survey', version: 1, participant: id, submittedAt: '', env: {}, answers },
})
const allSus = (v: number) => Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`sus${i + 1}`, v]))
const done = { self_T1: 'done', self_T2: 'done', self_T3: 'done', asked_help: 'no' }

describe('scores', () => {
  it('scores SUS the standard way', () => {
    // All 3s: odd items give 2, even items give 2, 20 × 2.5 = 50.
    expect(sus(allSus(3))).toBe(50)
    // Best possible: odd 5, even 1.
    const best = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`sus${i + 1}`, i % 2 ? 1 : 5]))
    expect(sus(best)).toBe(100)
    expect(sus({ sus1: 3 })).toBeNull()
  })
  it('scores NPS from promoters and detractors', () => {
    expect(nps([10, 9, 8, 7, 3])).toBe(20)
    expect(nps([])).toBeNull()
  })
  it('lets the moderator sheet decide completion over self-report', () => {
    const p = survey('P01', done)
    expect(independent(p)).toBe(true)
    p.observation = {
      kind: 'artps-g3-observation', version: 1, participant: 'P01', date: '', incidents: [], quotes: '',
      tasks: { T1: { result: 'done', assist: 2, seconds: 600, notes: '' }, T2: { result: 'done', assist: 0, seconds: 1, notes: '' }, T3: { result: 'done', assist: 0, seconds: 1, notes: '' } },
    }
    expect(independent(p)).toBe(false) // A hint (level 2) on the sky isn't on their own.
  })
})

describe('verdict', () => {
  const people = (spec: [boolean, string][]) => spec.map(([ok, light], i) =>
    survey(`P${i}`, { ...(ok ? done : { ...done, self_T1: 'failed' }), light, ...allSus(4), nps: 8 }))

  it('needs five people', () => {
    expect(summarize(people([[true, 'green']])).decision.light).toBeNull()
  })
  it('is green at 70% completion with half green', () => {
    const s = summarize(people([[true, 'green'], [true, 'green'], [true, 'green'], [true, 'yellow'], [true, 'yellow'], [true, 'yellow'], [false, 'yellow'], [false, 'red'], [true, 'green'], [true, 'green']]))
    expect(s.completionRate).toBe(0.8)
    expect(s.decision.light).toBe('green')
  })
  it('is red when fewer than half complete', () => {
    expect(summarize(people([[false, 'green'], [false, 'green'], [false, 'green'], [true, 'green'], [true, 'green']])).decision.light).toBe('red')
  })
  it('is yellow in between', () => {
    expect(summarize(people([[true, 'yellow'], [true, 'yellow'], [true, 'green'], [false, 'yellow'], [true, 'green']])).decision.light).toBe('yellow')
  })
})

// Writes docs/g3/questionnaire.md from src/g3/questions.ts, so the printed questionnaire and the survey page never
// differ.   npm run g3:doc

import { writeFileSync } from 'node:fs'
import { SECTIONS, TASKS } from '../src/g3/questions.ts'

const lines = [
  '# ArtPS · G3 反馈问卷',
  '',
  '> 由 `src/g3/questions.ts` 生成（`npm run g3:doc`），问卷页面 `?g3=survey` 用的是同一份题目。改题目请改那个文件。',
  '',
  '参与者做完任务后填写，约 5 分钟。标 *（可不答）* 的题可以跳过，其他都必答。',
  '',
  '## 任务（问卷里的自评和难度题对应这几项）',
  '',
  ...TASKS.map((t) => `- **${t.id} ${t.title}**：${t.goal}`),
  '',
]
let n = 0
for (const section of SECTIONS) {
  lines.push(`## ${section.title}`, '')
  if (section.intro) lines.push(`> ${section.intro}`, '')
  for (const q of section.questions) {
    n++
    const optional = q.optional ? ' *（可不答）*' : ''
    if (q.type === 'single') lines.push(`${n}. ${q.text}${optional}（单选）`, ...q.options.map((o) => `   - ○ ${o.label}`))
    else if (q.type === 'multi') lines.push(`${n}. ${q.text}${optional}（多选${q.max ? `，最多 ${q.max} 项` : ''}）`, ...q.options.map((o) => `   - □ ${o.label}`))
    else if (q.type === 'scale') lines.push(`${n}. ${q.text}${optional}`, `   - ${q.minLabel} ${Array.from({ length: q.max - q.min + 1 }, (_, i) => q.min + i).join(' · ')} ${q.maxLabel}`)
    else lines.push(`${n}. ${q.text}${optional}`, '   - ＿＿＿＿＿＿＿＿＿＿＿＿＿＿')
    lines.push('')
  }
}
lines.push(
  '## 怎么计分',
  '',
  '- **SUS（系统可用性量表）**：第 1、3、5、7、9 题得分 = 选项 − 1，第 2、4、6、8、10 题得分 = 5 − 选项，十题相加 × 2.5，得 0–100 分。行业平均约 68。',
  '- **NPS**：选 9–10 的占比 − 选 0–6 的占比。',
  '- **SEQ（单题难度）**：1–7，越高越容易，看各任务平均。',
  '- **独立完成（G3.2）**：三个必做任务都完成；有主持人记录时，看记录（最多 1 级帮助）；没有时，看自评（都选“完成了”且没有求助）。',
  '- **三色灯（G3.3）**：看“对你来说，ArtPS 是”一题。判定规则见 [README](README.md#判定规则)。',
  '',
)
writeFileSync('docs/g3/questionnaire.md', lines.join('\n'))
console.log(`Wrote docs/g3/questionnaire.md: ${n} questions`)

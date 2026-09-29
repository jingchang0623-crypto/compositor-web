// G3 user test: the tasks and the questionnaire, in one place. The task card, the observation sheet, the survey page
// and docs/g3/questionnaire.md (npm run g3:doc) all read from here. No imports, so Node can read it directly.

export interface Task {
  id: 'T1' | 'T2' | 'T3' | 'T4'
  title: string
  /** What the participant is asked: the goal, never the steps. */
  goal: string
  /** What counts as done, for the moderator. */
  done: string
  optional?: boolean
}

export const TASKS: Task[] = [
  {
    id: 'T1', title: '换天空',
    goal: '把街景里灰蒙蒙的天空换成提供的晚霞（sky.jpg）。楼、天线和树要留在天空前面。',
    done: '整片天空都换成了晚霞；楼顶边缘没有被天空盖住（允许几像素误差，楼缝里露出的树冠不强求）。用蒙版或删除像素都算。',
  },
  {
    id: 'T2', title: '调色',
    goal: '调整街景的颜色和明暗，让它看起来像被晚霞照着：整体更暖，和新天空协调。',
    done: '街景有明显的变暖或明暗调整（调整图层或其他方式都算），看得出是为了和天空协调。',
  },
  {
    id: 'T3', title: '导出',
    goal: '把结果导出成一张 JPEG 图片，发给主持人。',
    done: '得到一张 JPEG 文件，内容是换好天空的画面。',
  },
  {
    id: 'T4', title: '保存项目（可选）', optional: true,
    goal: '把项目保存下来，方便以后接着改。',
    done: '得到一个 .comp 文件夹或 .comp.zip。',
  },
]

export type Option = { value: string; label: string }
export type Question =
  | { id: string; type: 'single'; text: string; options: Option[]; optional?: boolean }
  | { id: string; type: 'multi'; text: string; options: Option[]; max?: number; optional?: boolean }
  | { id: string; type: 'scale'; text: string; min: number; max: number; minLabel: string; maxLabel: string; optional?: boolean }
  | { id: string; type: 'text'; text: string; placeholder?: string; optional?: boolean }

export interface Section {
  id: string
  title: string
  intro?: string
  questions: Question[]
}

const seq = (task: Task): Question => ({
  id: `seq_${task.id}`, type: 'scale', text: `「${task.title}」这一步，整体来说有多容易？`, min: 1, max: 7, minLabel: '非常难', maxLabel: '非常容易',
})

const self = (task: Task): Question => ({
  id: `self_${task.id}`, type: 'single', text: `「${task.title}」你完成了吗？`, optional: task.optional,
  options: [
    { value: 'done', label: '完成了' },
    { value: 'partial', label: '做了一部分' },
    { value: 'failed', label: '没做成' },
    ...(task.optional ? [{ value: 'skipped', label: '没尝试' }] : []),
  ],
})

/** The System Usability Scale, in Chinese: odd items are positive, even negative (Brooke, 1986). */
export const SUS_ITEMS = [
  '我想我会经常使用这个工具。',
  '我觉得这个工具没必要这么复杂。',
  '我觉得这个工具用起来很容易。',
  '我觉得需要有懂技术的人帮忙，才能用好这个工具。',
  '我觉得这个工具的各项功能结合得很好。',
  '我觉得这个工具里有太多前后不一致的地方。',
  '我想大部分人都能很快学会用这个工具。',
  '我觉得这个工具用起来很别扭。',
  '用这个工具时，我很有把握。',
  '我需要先学很多东西，才能上手这个工具。',
]

export const SECTIONS: Section[] = [
  {
    id: 'background', title: '关于你',
    questions: [
      { id: 'ps_years', type: 'single', text: '你用 Photoshop（或类似的专业修图软件）多久了？', options: [
        { value: 'none', label: '没用过' }, { value: 'lt1', label: '不到 1 年' }, { value: '1to3', label: '1–3 年' },
        { value: '3to5', label: '3–5 年' }, { value: 'gt5', label: '5 年以上' },
      ] },
      { id: 'frequency', type: 'single', text: '你多久做一次合成、修图或调色？', options: [
        { value: 'daily', label: '几乎每天' }, { value: 'weekly', label: '每周几次' }, { value: 'monthly', label: '每月几次' }, { value: 'rarely', label: '很少' },
      ] },
      { id: 'work', type: 'multi', text: '你主要用它做什么？', options: [
        { value: 'composite', label: '合成' }, { value: 'retouch', label: '人像 / 商品修图' }, { value: 'photo', label: '摄影后期调色' },
        { value: 'design', label: '海报 / 社媒图设计' }, { value: 'ui', label: 'UI / 网页素材' }, { value: 'other', label: '其他' },
      ] },
      { id: 'tools', type: 'multi', text: '你现在常用哪些工具？', options: [
        { value: 'photoshop', label: 'Photoshop' }, { value: 'affinity', label: 'Affinity Photo' }, { value: 'photopea', label: 'Photopea' },
        { value: 'gimp', label: 'GIMP' }, { value: 'pixelmator', label: 'Pixelmator' }, { value: 'compositor', label: '桌面版 Compositor' },
        { value: 'lightroom', label: 'Lightroom' }, { value: 'canva', label: 'Canva / 稿定' }, { value: 'mobile', label: '醒图 / 美图等手机 App' },
        { value: 'other', label: '其他' },
      ] },
    ],
  },
  {
    id: 'tasks', title: '刚才的任务',
    intro: '按你的真实感受选，没有对错，也不是在考你。',
    questions: [
      ...TASKS.flatMap((t) => (t.optional ? [self(t)] : [self(t), seq(t)])),
      { id: 'asked_help', type: 'single', text: '做任务时，你向别人（包括主持人）求助过吗？', options: [
        { value: 'no', label: '没有' }, { value: 'once', label: '一两次' }, { value: 'often', label: '好几次' },
      ] },
      { id: 'smooth', type: 'scale', text: '操作时画面流畅吗？（拖动、缩放、画笔）', min: 1, max: 5, minLabel: '很卡', maxLabel: '很流畅' },
      { id: 'stuck', type: 'text', text: '哪一步最让你卡住或困惑？当时你期望它怎么工作？', placeholder: '比如：我想用魔棒选天空，但没找到……' },
    ],
  },
  {
    id: 'sus', title: '整体感受', intro: '每句话选一个最接近你感受的程度。',
    questions: SUS_ITEMS.map((text, i) => ({
      id: `sus${i + 1}`, type: 'scale' as const, text, min: 1, max: 5, minLabel: '非常不同意', maxLabel: '非常同意',
    })),
  },
  {
    id: 'value', title: '对你有没有用',
    questions: [
      { id: 'light', type: 'single', text: '对你来说，这个网页版工具是：', options: [
        { value: 'green', label: '🟢 很有共鸣，我想继续用' },
        { value: 'yellow', label: '🟡 可有可无' },
        { value: 'red', label: '🔴 和我没什么关系' },
      ] },
      { id: 'light_why', type: 'text', text: '为什么这么选？' },
      { id: 'use_when', type: 'single', text: '如果它一直免费可用，你会怎么用它？', options: [
        { value: 'main', label: '当主力，替代我现在的工具' },
        { value: 'scenario', label: '在特定场合用（比如电脑没装 PS、要快速处理一张图）' },
        { value: 'rare', label: '偶尔用用' },
        { value: 'never', label: '不会用' },
      ] },
      { id: 'missing', type: 'multi', max: 3, text: '要让你愿意用它做真实工作，最先要补上哪些功能？', options: [
        { value: 'wand', label: '魔棒 / 选择主体（自动选区）' }, { value: 'lasso', label: '套索' }, { value: 'crop', label: '裁剪 / 画布大小' },
        { value: 'text', label: '文字' }, { value: 'effects', label: '图层样式（描边、投影）' }, { value: 'gradient', label: '渐变' },
        { value: 'heal', label: '修复画笔 / 仿制图章' }, { value: 'psd', label: '打开 / 保存 PSD' }, { value: 'pressure', label: '数位板压感' },
        { value: 'adjust', label: '更多调整（色彩平衡、黑白、渐变映射…）' }, { value: 'mobile', label: '平板 / 手机上能用' }, { value: 'other', label: '其他' },
      ] },
      { id: 'missing_other', type: 'text', optional: true, text: '还缺什么？（可不填）' },
    ],
  },
  {
    id: 'pay', title: '付费意愿', intro: '只是想了解价值，不会真的收费。',
    questions: [
      { id: 'pay_features', type: 'multi', text: '下面哪些，你愿意为它付费？', options: [
        { value: 'ai_select', label: 'AI 抠图 / 一键选主体' }, { value: 'ai_fill', label: 'AI 智能填充 / 扩图' },
        { value: 'sync', label: '云端保存、多台设备接着改' }, { value: 'collab', label: '多人协作 / 客户在线批注' },
        { value: 'psd', label: '完整的 PSD 兼容' }, { value: 'none', label: '都不愿意付费' },
      ] },
      { id: 'pay_month', type: 'single', text: '为一个满足你需要的网页版合成工具，你每月最多愿意付：', options: [
        { value: '0', label: '0 元，只用免费的' }, { value: 'lt10', label: '10 元以内' }, { value: '10to30', label: '10–30 元' },
        { value: '30to60', label: '30–60 元' }, { value: 'gt60', label: '60 元以上' },
      ] },
    ],
  },
  {
    id: 'recommend', title: '最后',
    questions: [
      { id: 'nps', type: 'scale', text: '你有多大可能把它推荐给做设计或修图的朋友？', min: 0, max: 10, minLabel: '完全不可能', maxLabel: '非常可能' },
      { id: 'anything', type: 'text', optional: true, text: '还有什么想说的？（可不填）' },
      { id: 'revisit', type: 'single', text: '下一个版本出来时，愿意再试一次吗？', options: [
        { value: 'yes', label: '愿意' }, { value: 'maybe', label: '看情况' }, { value: 'no', label: '不了' },
      ] },
    ],
  },
]

export const ALL_QUESTIONS: Question[] = SECTIONS.flatMap((s) => s.questions)

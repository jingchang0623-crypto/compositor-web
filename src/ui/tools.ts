// The tool rail, in upstream's order (Document/EditorSession.swift, NavigationTool), with its keys and hints.

import {
  Bandage, Crop, Droplet, Hand, Lasso, Move, Paintbrush, Pipette, Search, Shapes, SquareDashed, SquareSplitVertical,
  Stamp, Type, WandSparkles, type LucideIcon,
} from 'lucide-react'

export type ToolID =
  | 'move' | 'marquee' | 'lasso' | 'wand' | 'crop' | 'brush' | 'spotHealing' | 'cloneStamp' | 'blur' | 'gradient'
  | 'shape' | 'type' | 'eyedropper' | 'hand' | 'zoom' | 'idle'

export interface Tool {
  id: ToolID
  name: string
  key: string
  icon: LucideIcon
  /** What the status bar says while the tool is chosen. */
  hint: string
  /** Works in this build; the rest arrive in G2. */
  ready?: boolean
}

export const TOOLS: Tool[] = [
  { id: 'move', name: '移动 / 变换', key: 'V', icon: Move, hint: '拖动移动 · 手柄缩放（Shift 自由比例，Option 从中心）· 圆点旋转（Shift 15°）· 方向键微移 · Ctrl 不吸附 · 1–0 不透明度', ready: true },
  { id: 'marquee', name: '选框', key: 'M', icon: SquareDashed, hint: '拖出选区 · Shift 加选 · Option 减选 · 选区内拖动移动 · ⌫ 清除 · ⌥⌫ 填充前景色 · ⌘D 取消选择', ready: true },
  { id: 'lasso', name: '套索', key: 'L', icon: Lasso, hint: '拖动选区 · Shift 加选 · Option 减选 · ⌘D 取消选择' },
  { id: 'wand', name: '魔棒 · Tab 切换对象选择', key: 'W', icon: WandSparkles, hint: '点击选择相近颜色 · Tab 切换对象选择 · Shift 加选 · Option 减选' },
  { id: 'crop', name: '裁剪', key: 'C', icon: Crop, hint: '拖动裁剪 · Enter 应用 · Esc 取消 · 空格平移' },
  { id: 'brush', name: '画笔 · E 橡皮', key: 'B', icon: Paintbrush, hint: '拖动绘画 · Shift 点击画直线 · [ ] 大小 · Shift-[ ] 硬度 · 1–0 不透明度 · X 交换颜色 · 空格平移', ready: true },
  { id: 'spotHealing', name: '污点修复画笔', key: 'J', icon: Bandage, hint: '在瑕疵上涂抹修复 · [ ] 大小 · 空格平移' },
  { id: 'cloneStamp', name: '仿制图章 · Option 点击取样', key: 'S', icon: Stamp, hint: 'Option 点击设置取样点 · 拖动仿制 · [ ] 大小 · 空格平移' },
  { id: 'blur', name: '涂抹', key: 'R', icon: Droplet, hint: '拖动柔化 · [ ] 大小 · 1–0 强度 · 空格平移' },
  { id: 'gradient', name: '渐变', key: 'G', icon: SquareSplitVertical, hint: '拖动绘制 · 拖端点调整 · Shift 45° · Enter 应用' },
  { id: 'shape', name: '形状 · Shift-U 切换', key: 'U', icon: Shapes, hint: '拖动在新图层上画形状 · Shift 等比 · Option 从中心' },
  { id: 'type', name: '文字', key: 'T', icon: Type, hint: '拖出文本框 · 点击文字编辑 · ⌘Return 完成 · Esc 取消' },
  { id: 'eyedropper', name: '吸管', key: 'I', icon: Pipette, hint: '点击取色' },
  { id: 'hand', name: '抓手', key: 'H', icon: Hand, hint: '拖动平移 · 双指捏合缩放 · 双击图标适配窗口', ready: true },
  { id: 'zoom', name: '缩放', key: 'Z', icon: Search, hint: '点击放大 · Option 点击缩小 · 左右拖动平滑缩放 · 双击图标 100%', ready: true },
]

export const IDLE_HINT = '未选择工具 · 按工具快捷键选择 · 空格平移'

export function toolByKey(key: string): ToolID | undefined {
  const k = key.toUpperCase()
  if (k === 'A') return 'idle'
  if (k === 'E') return 'brush'
  return TOOLS.find((t) => t.key === k)?.id
}

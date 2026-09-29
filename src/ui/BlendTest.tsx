import { useEffect, useState } from 'react'
import { runBlendTests, TOLERANCE, type TestRow } from '../bench/blendTest'

declare global {
  interface Window {
    __blendTest?: { rows: TestRow[]; pass: boolean }
  }
}

export function BlendTest() {
  const [rows, setRows] = useState<TestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    try {
      const result = runBlendTests()
      window.__blendTest = { rows: result, pass: result.every((r) => r.pass) }
      setRows(result)
    } catch (e) {
      setError(String(e))
    }
  }, [])
  const passed = rows?.filter((r) => r.pass).length ?? 0
  return (
    <div className="report">
      <p><a href="./">← 返回编辑器</a></p>
      <h2>G0.1 混合模式与调整层：GPU 对 CPU 参考</h2>
      <p>64×64 测试图，含 0/½/1 边界值与半透明区域；图层不透明度 80%。容差 {TOLERANCE}/255。</p>
      {error && <p className="fail">{error}</p>}
      {rows && (
        <>
          <p className={passed === rows.length ? 'pass' : 'fail'}>{passed} / {rows.length} 通过</p>
          <table>
            <thead><tr><th>项目</th><th>最大误差</th><th>超出容差的通道</th><th>结果</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.maxError}</td>
                  <td>{r.over} / {r.channels}</td>
                  <td className={r.pass ? 'pass' : 'fail'}>{r.pass ? '通过' : '未通过'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

import { describe, expect, it } from 'vitest'
import { descendants, duplicate, folderLayer, groupLayer, insertAbove, moveLayer, removeLayers, ungroup } from './document'
import { fullCanvasTransform, parseManifest, type LayerRecord } from './manifest'
import { renderList } from './renderList'

const L = (id: string, extra: Partial<LayerRecord> = {}): LayerRecord =>
  ({ id, name: id, isVisible: true, transform: fullCanvasTransform(10, 10), imageFile: extra.isGroup ? undefined : `${id}.png`, ...extra })
const ids = (layers: LayerRecord[]) => layers.map((l) => l.id).join(' ')
const order = (layers: LayerRecord[]) => renderList(parseManifest({
  format: 'com.compositor.project', version: 11, colorSpace: 'sRGB', documentID: 'D', width: 10, height: 10, layers,
})).map((s) => s.layer.id).join(' ')

describe('document edits', () => {
  const base = [L('A'), L('F', { isGroup: true }), L('B', { parentID: 'F' }), L('C')]

  it('inserts above an anchor, among its siblings', () => {
    expect(order(insertAbove(base, 'B', [L('N')]))).toBe('A B N C')
    expect(insertAbove(base, 'B', [L('N')]).find((l) => l.id === 'N')?.parentID).toBe('F')
    expect(order(insertAbove(base, undefined, [L('N')]))).toBe('A B C N')
  })

  it('removes a folder with its contents', () => {
    expect(ids(removeLayers(base, ['F']))).toBe('A C')
  })

  it('moves layers in and out of folders, never into themselves', () => {
    expect(order(moveLayer(base, 'C', 'F', 0))).toBe('A C B')
    expect(order(moveLayer(base, 'B', undefined, 0))).toBe('B A C')
    expect(moveLayer(base, 'F', 'F', 0)).toEqual(base)
  })

  it('groups and ungroups in place', () => {
    const folder = folderLayer('Folder 1', 10, 10)
    const grouped = groupLayer(base, 'C', folder)
    expect(order(grouped)).toBe('A B C')
    expect(grouped.find((l) => l.id === 'C')?.parentID).toBe(folder.id)
    expect(order(ungroup(grouped, folder.id))).toBe('A B C')
    expect(ungroup(grouped, folder.id).some((l) => l.id === folder.id)).toBe(false)
  })

  it('duplicates a folder with new ids and file names, keeping its shape', () => {
    const { records, rename } = duplicate(base, 'F', (n) => `${n} copy`)
    expect(records).toHaveLength(2)
    expect(records[0].name).toBe('F copy')
    expect(records[1].parentID).toBe(records[0].id)
    expect(rename.get('B.png')).toBe(`${records[1].id}.png`)
    const withCopy = insertAbove(base, 'F', records)
    expect(descendants(withCopy, records[0].id).map((l) => l.id)).toEqual([records[1].id])
    expect(order(withCopy)).toBe(`A B ${records[1].id} C`)
  })
})

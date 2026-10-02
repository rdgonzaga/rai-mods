import { expect, mock, test } from 'claude-code/testing'
import { scaleGrid, scaleFor, cellsOf, pixels, dims } from '../hooks/sprite.js'

function pane(columns: number, placement: 'dock' | 'inline', windowRows = 50) {
  return {
    plugin: 'rai-hud',
    component: 'Pane',
    requestId: 'rai-hud',
    surface: 'terminal',
    viewport: { columns: 200, rows: windowRows },
    props: { title: 'rai//hud', isFocused: false, bodyColumns: columns, placement, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  } as const
}

function setup(on) {
  mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('session.repo', () => ({ value: null }))
  on('store.get', () => ({ value: undefined }))
  for (const n of ['ui.toast', 'ui.blit', 'ui.close', 'command.register', 'store.set']) on(n, () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
}

test('scaleGrid doubles every pixel and cellsOf packs any size', () => {
  const d = dims('full')
  const g = pixels('IDLE', 1, { size: 'full' })
  expect(g.length).toBe(d.height)
  expect([...g[0]].length).toBe(d.width)
  const big = scaleGrid(g, 2)
  expect(big.length).toBe(d.height * 2)
  expect([...big[0]].length).toBe(d.width * 2)
  expect([...big[2 * 5]][2 * 10]).toBe([...g[5]][10])
  // 3 numbers of 4 bytes per cell, base64 is 4/3 of the bytes; 2 pixel rows per cell
  const cells = cellsOf(big)
  expect(Math.round((cells.length * 3) / 4 / 12)).toBe(d.width * 2 * d.height)
  expect(scaleFor(40, 3, 'full')).toBe(1)
  expect(scaleFor(120, 3, 'full')).toBe(2)
  expect(scaleFor(60, 3, 'mini')).toBe(2)
  expect(scaleFor(100, 2, 'mini')).toBe(2)
})

test('the mini scene is its own drawing, not a shrunk copy', () => {
  const d = dims('mini')
  const g = pixels('EDITING', 3, { size: 'mini' })
  expect(g.length).toBe(d.height)
  expect([...g[0]].length).toBe(d.width)
})

test('a wide sidebar draws the full scene, at 2x when there is room', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  let ui = await $.ui.mount(pane(62, 'dock'))
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 60, rows: 18 } })
  expect(await ui.find({ key: 'tab-tasks' })).toMatchObject({ props: { label: 'tasks' } })
  await ui.unmount()
  ui = await $.ui.mount(pane(124, 'dock', 100))
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 120, rows: 36 } })
})

test('a narrow sidebar draws the mini scene and shortens the tabs', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount(pane(34, 'dock'))
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 30, rows: 10 } })
  expect(await ui.find({ key: 'tab-tasks' })).toMatchObject({ props: { label: 'tsk' } })
  expect(await ui.find({ key: 'tab-files' })).toMatchObject({ props: { label: '≡' } })
})

test('above the prompt in a short window, the mini scene still shows', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount(pane(80, 'inline', 28))
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 30, rows: 10 } })
})

test('only a tiny window or a sliver of a pane falls back to the face', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  let ui = await $.ui.mount(pane(80, 'inline', 16))
  expect(await ui.find({ key: 'mascot' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^U.ᴥ.U/ })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(pane(24, 'dock', 50))
  expect(await ui.find({ key: 'mascot' })).toBeUndefined()
})

test('a short window never gets a mascot taller than ~half the screen', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount(pane(100, 'dock', 36))
  // The full scene (18 rows) is too tall for 36 rows, so the mini one draws
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 30, rows: 10 } })
})

const BAND = {
  plugin: 'rai-hud',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

test('in a narrow terminal the mascot rides in the band, and your prompt places the sidebar', async ($, on) => {
  mock.clock(on)
  const opens: boolean[] = []
  let calls = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('session.repo', () => ({ value: null }))
  on('store.get', () => ({ value: undefined }))
  for (const n of ['ui.toast', 'ui.blit', 'ui.close', 'command.register', 'store.set']) on(n, () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  // Unasked at startup it waits; behind the prompt it's placed
  on('ui.open', () => {
    calls += 1
    const isPlaced = calls > 1
    opens.push(isPlaced)
    return { value: isPlaced ? { isPlaced } : { isPlaced, reason: 'narrow' } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  let band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^U.ᴥ.U/ })).toBeDefined()
  // The session opens with the boot animation
  expect(await band.find({ type: 'Text', text: '[BOOT]' })).toBeDefined()
  await band.unmount()
  await $.prompt.submit({ text: 'hello' })
  expect(opens).toEqual([false, true])
  band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: /^U.ᴥ.U/ })).toBeUndefined()
})


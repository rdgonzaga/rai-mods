import { expect, mock, test } from 'claude-code/testing'
import { scaleGrid, scaleFor, cellsOf, pixels, WIDTH, HEIGHT } from '../hooks/sprite.js'

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
  const g = pixels('IDLE', 1)
  const big = scaleGrid(g, 2)
  expect(big.length).toBe(HEIGHT * 2)
  expect(big[0].length).toBe(WIDTH * 2)
  expect(big[2 * 5][2 * 10]).toBe(g[5][10])
  // 3 numbers of 4 bytes per cell, base64 is 4/3 of the bytes
  const cells = cellsOf(big)
  expect(Math.round((cells.length * 3) / 4 / 12)).toBe(WIDTH * 2 * HEIGHT)
  expect(scaleFor(40)).toBe(1)
  expect(scaleFor(60)).toBe(2)
  expect(scaleFor(100)).toBe(3)
  expect(scaleFor(100, 2)).toBe(2)
})

test('a wide sidebar draws the mascot at 2x, centered', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount(pane(62, 'dock'))
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 56, rows: 18 } })
  expect(await ui.find({ key: 'tab-tasks' })).toMatchObject({ props: { label: 'tasks' } })
})

test('a narrow sidebar keeps 1x and shortens the tabs', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount(pane(34, 'dock'))
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 28, rows: 9 } })
  expect(await ui.find({ key: 'tab-tasks' })).toMatchObject({ props: { label: 'tsk' } })
  expect(await ui.find({ key: 'tab-files' })).toMatchObject({ props: { label: '≡' } })
})

test('above the prompt, the mascot still shows at 1x in a short window', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount(pane(80, 'inline', 28))
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 28, rows: 9 } })
})

test('only a tiny window or a sliver of a pane falls back to the face', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  let ui = await $.ui.mount(pane(80, 'inline', 16))
  expect(await ui.find({ key: 'mascot' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '(•_•)' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(pane(24, 'dock', 50))
  expect(await ui.find({ key: 'mascot' })).toBeUndefined()
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
  expect(await band.find({ type: 'Text', text: '(•_•)' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '[IDLE]' })).toBeDefined()
  await band.unmount()
  await $.prompt.submit({ text: 'hello' })
  expect(opens).toEqual([false, true])
  band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: '(•_•)' })).toBeUndefined()
})

test('a short window never gets a mascot taller than ~half the screen', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount(pane(100, 'dock', 36))
  expect(await ui.find({ key: 'mascot' })).toMatchObject({ props: { columns: 28 } })
})

import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'rai-hud',
  component: 'Pane',
  requestId: 'rai-hud',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'rai//hud', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// A Windows session with a store that starts at `xp`; records sounds and toasts
function setup(on, { xp = 0, muted = false } = {}) {
  mock.clock(on)
  const store = new Map<string, unknown>([['xp', xp], ['muted', muted]])
  const sounds: string[] = []
  const toasts: string[] = []
  on('session.start', () => ({ cwd: 'C:\\work' }))
  on('session.repo', () => ({ value: null }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'powershell') sounds.push((e.argv[4].match(/sounds\\(\w+)\.wav/) || [])[1])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  for (const n of ['ui.blit', 'ui.close', 'command.register']) on(n, () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', ($, e) =>
    e.tool === 'AskUserQuestion' ? { result: { answers: { [e.questions[0].question]: 'Deny' } } } : { result: 'ran' },
  )
  return { store, sounds, toasts }
}

async function turn($, id: string, { tools = 0, ms = 1000, aborted = false } = {}) {
  await $.turn.start({ text: 'go', turnId: id })
  for (let i = 0; i < tools; i++) await $.tool.call({ tool: 'Read', file_path: 'C:/work/f' + i + '.ts' })
  await $.turn.complete({ turnId: id, answer: 'ok', durationMs: ms, isAborted: aborted, reason: aborted ? 'aborted' : 'answer', usage: null })
}

test('finished turns earn XP that is saved', async ($, on) => {
  const { store } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await turn($, 't1', { tools: 4 })
  expect(store.get('xp')).toBe(5 + 4)
  await turn($, 't2', { aborted: true })
  expect(store.get('xp')).toBe(9)
})

test('crossing a level shows LEVEL UP, toasts, and plays the fanfare', async ($, on) => {
  const { sounds, toasts } = setup(on, { xp: 45 })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await turn($, 't1', { tools: 2 })
  expect(toasts).toContain('[+] LEVEL UP :: LVL 2 packet sniffer')
  expect(sounds).toEqual(['levelup'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '[LEVELUP]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'LVL 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'packet sniffer' })).toBeDefined()
})

test('long turns chime, short ones stay quiet, guards sound the siren', async ($, on) => {
  const { sounds } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await turn($, 't1', { ms: 3000 })
  await turn($, 't2', { ms: 20000 })
  await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(sounds).toEqual(['done', 'alert'])
})

test('/hud mute silences sounds and is remembered', async ($, on) => {
  const { sounds, store } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  await $.command.run({ command: 'hud', args: 'mute' })
  expect(store.get('muted')).toBe(true)
  await turn($, 't1', { ms: 20000 })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  expect(sounds).toEqual([])
})

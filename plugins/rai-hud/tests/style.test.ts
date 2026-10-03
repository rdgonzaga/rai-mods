import { expect, mock, test } from 'claude-code/testing'
import { tagFor, targetFor, detailFor, patchCounts, mcpName, groupSummary, verbFor, fmtDuration, turnSummary, statusFor } from '../hooks/style.js'

// ── style.js units ─────────────────────────────────────────────────────────

test('every tool gets a four-character tag and a color', () => {
  expect(tagFor('Read')).toEqual(['read', 'cyan'])
  expect(tagFor('Edit')).toEqual(['edit', 'green'])
  expect(tagFor('Write')).toEqual(['writ', 'green'])
  expect(tagFor('PowerShell')).toEqual(['exec', 'yellow'])
  expect(tagFor('WebSearch')).toEqual(['net ', 'magenta'])
  expect(tagFor('mcp__github__create_pr')).toEqual(['mcp ', 'magenta'])
  expect(tagFor('SomethingNew')).toEqual(['tool', 'gray'])
  for (const t of ['Read', 'Glob', 'Agent', 'TodoWrite', 'Skill', 'x']) expect(tagFor(t)[0].length).toBe(4)
})

test('targets are short and repo-relative', () => {
  expect(targetFor('Edit', { file_path: 'C:\\work\\src\\auth.ts' }, 'C:/work')).toBe('src/auth.ts')
  expect(targetFor('Bash', { command: 'npm test' }, '')).toBe('npm test')
  expect(targetFor('Grep', { pattern: 'TODO', path: '/r/src' }, '/r')).toBe('TODO in src')
  expect(targetFor('WebFetch', { url: 'https://docs.anthropic.com/x' }, '')).toBe('docs.anthropic.com')
  expect(mcpName('mcp__github__create_pr')).toBe('github:create_pr')
})

test('details come from the finished output', () => {
  const patch = [{ lines: [' a', '-b', '+c', '+d', ' e'] }, { lines: ['-x', '+y'] }]
  expect(patchCounts(patch)).toEqual({ add: 3, del: 2 })
  expect(detailFor('Edit', { structuredPatch: patch })).toBe('+3 -2')
  expect(detailFor('Write', { type: 'create', structuredPatch: [] })).toBe('new')
  expect(detailFor('Read', { file: { numLines: 120 } })).toBe('120 lines')
  expect(detailFor('Glob', { numFiles: 1 })).toBe('1 file')
  expect(detailFor('Bash', { stdout: 'x' })).toBe('')
})

test('status marks, group summaries, verbs, and the turn line', () => {
  expect(statusFor({ isRunning: true })).toEqual(['…', 'yellow'])
  expect(statusFor({ isErrored: true })).toEqual(['✗', 'red'])
  expect(statusFor({ isInterrupted: true, isErrored: true })).toEqual(['⊘', 'red'])
  expect(statusFor({})).toEqual(['', 'green'])
  expect(groupSummary([{ tool: 'Read' }, { tool: 'Read' }, { tool: 'Grep' }, { tool: 'Glob' }])).toBe('2 reads · 1 grep · 1 glob')
  expect(verbFor('EDITING', 0)).toBe('Injecting')
  expect(verbFor('EDITING', 7)).toBe(verbFor('EDITING', 7))
  expect(fmtDuration(41000)).toBe('41s')
  expect(fmtDuration(64000)).toBe('1m04s')
  expect(turnSummary({ tools: 6, files: 2, xpGain: 18 }, 41000)).toEqual({ label: '✓', color: 'green', text: '41s · +18xp' })
  expect(turnSummary({ tools: 1, files: 0, xpGain: 0, aborted: true }, 3000)).toEqual({ label: '✗', color: 'red', text: 'aborted 3s' })
  expect(turnSummary({ tools: 1, files: 0, xpGain: 0, error: true }, 3000).text).toBe('error 3s')
  expect(turnSummary(undefined, 5000).text).toBe('5s')
})

// ── Mounted sites ──────────────────────────────────────────────────────────

const STOCK = { type: 'Text', props: {}, children: ['stock'] }

function setup(on, { style = true } = {}) {
  mock.clock(on)
  const seen: any[] = []
  on('session.start', () => ({ cwd: 'C:\\work' }))
  on('session.repo', () => ({ value: { root: 'C:/work', remote: null, internal: false } }))
  on('store.get', ($, e) => ({ value: e.key === 'style' ? style : undefined }))
  for (const n of ['ui.toast', 'ui.blit', 'ui.close', 'command.register', 'store.set']) on(n, () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '' } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ran' }))
  // What Claude Code draws when a hook passes the event on
  on('ui.render', ($, e) => {
    seen.push(e)
    return STOCK
  })
  return seen
}

function site(component: string, props: any, requestId = 'r1') {
  return { plugin: 'rai-hud', component, requestId, surface: 'terminal', viewport: { columns: 120, rows: 40 }, props } as any
}

async function start($) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
}

test('ToolUse draws a tagged header for each state', async ($, on) => {
  setup(on)
  await start($)
  const patch = [{ lines: ['+a', '+b', '-c'] }]
  let ui = await $.ui.mount(site('ToolUse', { tool_use_id: 't', tool: 'Edit', input: { file_path: 'C:/work/src/auth.ts' }, isRunning: false, isErrored: false, isInterrupted: false, output: { structuredPatch: patch } }))
  expect(await ui.find({ type: 'Text', text: 'edit' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'src/auth.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+2 -1' })).toBeDefined()
  // A call that worked gets no mark
  expect(await ui.find({ type: 'Text', text: '✓' })).toBeUndefined()
  await ui.unmount()
  ui = await $.ui.mount(site('ToolUse', { tool_use_id: 't2', tool: 'Bash', input: { command: 'npm test' }, isRunning: true, isErrored: false, isInterrupted: false }))
  expect(await ui.find({ type: 'Text', text: 'exec' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '…' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(site('ToolUse', { tool_use_id: 't3', tool: 'Bash', input: { command: 'sleep 9' }, isRunning: false, isErrored: true, isInterrupted: true }))
  expect(await ui.find({ type: 'Text', text: '⊘' })).toBeDefined()
})

test('ToolGroup folds into one scan line, and unfolds untouched', async ($, on) => {
  const seen = setup(on)
  await start($)
  const calls = [{ tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }, { tool: 'Grep', input: {}, isRunning: false, isErrored: false, isInterrupted: false }]
  let ui = await $.ui.mount(site('ToolGroup', { calls, isActive: false, isExpanded: false }))
  expect(await ui.find({ type: 'Text', text: 'scan' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 read · 1 grep' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(site('ToolGroup', { calls, isActive: false, isExpanded: true }))
  expect(await ui.find({ type: 'Text', text: 'stock' })).toBeDefined()
  expect(seen.some((e) => e.component === 'ToolGroup')).toBe(true)
})

test('replies are left untouched', async ($, on) => {
  const seen = setup(on)
  await start($)
  await $.ui.mount(site('AssistantMessage', { text: 'Fixed it.', isFirstOfReply: true }))
  const texts = seen.filter((e) => e.component === 'AssistantMessage').map((e) => e.props.text)
  expect(texts).toEqual(['Fixed it.'])
})

test('your prompts read as a shell line; other messages are left alone', async ($, on) => {
  const seen = setup(on)
  await start($)
  let ui = await $.ui.mount(site('UserMessage', { text: 'fix the bug', origin: { kind: 'composer' }, isExpanded: true }))
  expect(await ui.find({ type: 'Text', text: 'rai@hud:~$' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'fix the bug' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(site('UserMessage', { text: 'task done', origin: { kind: 'task-notification' }, isExpanded: true }, 'r2'))
  expect(await ui.find({ type: 'Text', text: 'stock' })).toBeDefined()
})

test('the turn-end line shows the turn stats and XP', async ($, on) => {
  setup(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/work/a.ts' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/work/a.ts' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 41000, isAborted: false, reason: 'answer', usage: null })
  let ui = await $.ui.mount(site('TurnDuration', { word: 'Baked', durationMs: 41000 }, 'm1'))
  expect(await ui.find({ type: 'Text', text: '✓' })).toBeDefined()
  // 5 for the turn + 2 tool calls + 3 for the edited file
  expect(await ui.find({ type: 'Text', text: '41s · +10xp' })).toBeDefined()
  await ui.unmount()
  // A row from before rai-hud loaded: duration only
  ui = await $.ui.mount(site('TurnDuration', { word: 'Baked', durationMs: 3000 }, 'm-old'))
  expect(await ui.find({ type: 'Text', text: '3s' })).toBeDefined()
})

test('the spinner word becomes a hacker verb in the terminal', async ($, on) => {
  const seen = setup(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'C:/work/a.ts' })
  await $.ui.mount(site('Spinner', { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' }))
  const spin = seen.find((e) => e.component === 'Spinner')
  expect(['Injecting', 'Patching', 'Rewriting']).toContain(spin.props.word)
  expect(spin.props.suffix).toBe('…')
})

test('hint line and footer stay stock; notices get an [i] tag', async ($, on) => {
  const seen = setup(on)
  await start($)
  await $.ui.mount(site('PromptHint', { isDraft: false, isWorking: false, hint: '? for shortcuts' }))
  await $.ui.mount(site('SessionMode', { modes: ['focus'] }))
  await $.ui.mount(site('InfoNotice', { text: 'Using Opus', command: null }))
  const by = (c) => seen.find((e) => e.component === c).props
  expect(by('PromptHint').tail).toBeUndefined()
  expect(by('SessionMode').modes).toEqual(['focus'])
  expect(by('InfoNotice').text).toBe('[i] Using Opus')
})

test('/hud style off hands every site back to Claude Code', async ($, on) => {
  setup(on, { style: false })
  await start($)
  for (const [c, props] of [
    ['ToolUse', { tool_use_id: 't', tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }],
    ['UserMessage', { text: 'hi', origin: { kind: 'composer' }, isExpanded: true }],
    ['TurnDuration', { word: 'Baked', durationMs: 1000 }],
  ] as const) {
    const ui = await $.ui.mount(site(c, props, 'x-' + c))
    expect(await ui.find({ type: 'Text', text: 'stock' })).toBeDefined()
    await ui.unmount()
  }
})

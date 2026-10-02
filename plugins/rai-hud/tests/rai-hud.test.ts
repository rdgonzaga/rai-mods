import { expect, mock, test } from 'claude-code/testing'

// Fake git answers: on `branch`, 2 ahead of origin, 1 stash, auth.ts changed, new.ts untracked
function gitOut(argv: string[], branch: string) {
  const a = argv.slice(1).join(' ')
  if (a.startsWith('branch --show-current')) return branch + '\n'
  if (a.startsWith('rev-parse')) return 'origin/' + branch + '\n'
  if (a.startsWith('stash list')) return 'stash@{0}: WIP\n'
  if (a.startsWith('rev-list')) return '0\t2\n'
  if (a.startsWith('log')) return 'abc1234 fix auth\ndef5678 add tests\n'
  if (a.startsWith('diff --numstat')) return '12\t3\tsrc/auth.ts\n'
  if (a.startsWith('ls-files')) return 'src/new.ts\n'
  return ''
}

// Stubs shared by every test: a repo on `branch`, and the user answering `answer`
function setup(on, { branch = 'feature/x', answer = 'Deny', paneCalls = [] as string[] } = {}) {
  mock.clock(on)
  const asked: string[] = []
  on('session.start', () => ({ cwd: '/work' }))
  on('session.repo', () => ({ value: { root: '/work', remote: null, internal: false } }))
  on('process.run', ($, e) => ({ value: { exitCode: 0, stdout: gitOut(e.argv, branch), stderr: '' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => {
    paneCalls.push('open')
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    paneCalls.push('close')
    return { value: undefined }
  })
  on('ui.blit', () => ({ value: {} }))
  on('command.register', () => ({ value: undefined }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      asked.push(e.questions[0].question)
      return { result: { answers: { [e.questions[0].question]: answer } } }
    }
    return { result: 'ran' }
  })
  return asked
}

test('ordinary commands run without a question', async ($, on) => {
  const asked = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const out = await $.tool.call({ tool: 'Bash', command: 'git status && ls' })
  expect(out).toEqual({ result: 'ran' })
  expect(asked).toEqual([])
})

test('a blocked push is denied', async ($, on) => {
  const asked = setup(on, { answer: 'Deny' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const out = await $.tool.call({ tool: 'PowerShell', command: 'git push origin feature/x' })
  expect(out.deny).toMatch(/blocked/)
  expect(asked[0]).toMatch(/PUSH/)
})

test('an approved force push runs', async ($, on) => {
  const asked = setup(on, { answer: 'Authorize' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const out = await $.tool.call({ tool: 'Bash', command: 'git push -f origin x' })
  expect(out).toEqual({ result: 'ran' })
  expect(asked[0]).toMatch(/FORCE_PUSH/)
})

test('commits ask only on main', async ($, on) => {
  const asked = setup(on, { branch: 'main' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const out = await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })
  expect(out.deny).toBeDefined()
  expect(asked[0]).toMatch(/COMMIT_ON_MAIN/)
})

test('commits on a feature branch go through', async ($, on) => {
  const asked = setup(on, { branch: 'feature/x' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const out = await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' })
  expect(out).toEqual({ result: 'ran' })
  expect(asked).toEqual([])
})

test('non-interactive runs skip the guard', async ($, on) => {
  const asked = setup(on)
  await $.session.start({ surface: null, isInteractive: false, cwd: '/work' })
  const out = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(out).toEqual({ result: 'ran' })
  expect(asked).toEqual([])
})

test('the band no longer repeats last-turn stats (the turn-end line has them)', async ($, on) => {
  setup(on, { branch: 'main' })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'a.md' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 41000, isAborted: false, reason: 'answer', usage: null })
  const ui = await $.ui.mount({
    plugin: 'rai-hud', component: 'AbovePrompt', surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 60, scroll: { offset: 0, bodyRows: 3 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: 'rai@hud:~$' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '[OK]' })).toBeUndefined()
})

test('the band stays empty before the first turn', async ($, on) => {
  setup(on)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['core'] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await $.ui.mount({
    plugin: 'rai-hud', component: 'AbovePrompt', surface: 'terminal',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 60, scroll: { offset: 0, bodyRows: 3 }, view: {} },
  })
  expect(await ui.find({ type: 'Text', text: 'rai@hud:~$' })).toBeUndefined()
})

const PANE = {
  plugin: 'rai-hud', component: 'Pane', requestId: 'rai-hud',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'rai//hud', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('the mascot pane tracks what Claude is doing', async ($, on) => {
  setup(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/auth.ts' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'mascot' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[EDITING]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'tgt: auth.ts' })).toBeDefined()
  await ui.unmount()
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
})

test('/hud toggles the pane', async ($, on) => {
  const calls: string[] = []
  setup(on, { paneCalls: calls })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'hud', args: '' })
  await $.command.run({ command: 'hud', args: '' })
  expect(calls).toEqual(['open', 'close', 'open'])
})

async function paneWithTab($, tab: string) {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-' + tab })
  return ui
}

test('tasks tab mirrors the plan', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'write parser', status: 'completed', activeForm: 'x' },
      { content: 'add tests', status: 'in_progress', activeForm: 'x' },
      { content: 'update docs', status: 'pending', activeForm: 'x' },
    ],
  })
  const ui = await paneWithTab($, 'tasks')
  expect(await ui.find({ key: 'tab-tasks' })).toMatchObject({ props: { label: 'tasks 1/3' } })
  expect(await ui.find({ type: 'Text', text: '[x] write parser' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[>] add tests' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[ ] update docs' })).toBeDefined()
})

test('files tab shows line counts and new files', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/src/auth.ts' })
  await $.tool.call({ tool: 'Write', file_path: '/work/src/new.ts' })
  const ui = await paneWithTab($, 'files')
  expect(await ui.find({ type: 'Text', text: 'src/auth.ts' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+12' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '-3' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'new' })).toBeDefined()
})

test('cmds tab marks passes, failures, and blocks', async ($, on) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('session.repo', () => ({ value: null }))
  for (const n of ['ui.toast', 'ui.blit', 'command.register']) on(n, () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') return { result: { answers: { [e.questions[0].question]: 'Deny' } } }
    if (e.command === 'npm test') return { result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true }
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  const ui = await paneWithTab($, 'cmds')
  expect(await ui.find({ key: 'tab-cmds' })).toMatchObject({ props: { label: 'cmds ✗1' } })
  expect(await ui.find({ type: 'Text', text: '✗' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⊘' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'npm test' })).toBeDefined()
})

test('git tab shows ahead, stash, and unpushed commits', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const ui = await paneWithTab($, 'git')
  expect(await ui.find({ key: 'tab-git' })).toMatchObject({ props: { label: 'git ↑2' } })
  expect(await ui.find({ type: 'Text', text: '↑2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'origin/feature/x' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'stash: 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  abc1234 fix auth' })).toBeDefined()
})

test('/hud <tab> jumps to that tab, and the arrows cycle tabs', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'hud', args: 'git' })
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'stash: 1' })).toBeDefined()
  await ui.press({ key: 'tab-next' })
  expect(await ui.find({ key: 'tab-ci' })).toMatchObject({ props: { dimColor: false } })
  await ui.press({ key: 'tab-prev' })
  await ui.press({ key: 'tab-prev' })
  expect(await ui.find({ type: 'Text', text: '// no shell commands yet' })).toBeDefined()
  expect(await ui.find({ key: 'tab-next' })).toMatchObject({ props: { action: 'app:diffFileListDown' } })
})

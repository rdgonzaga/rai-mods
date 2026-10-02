import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'rai-hud',
  component: 'Pane',
  requestId: 'rai-hud',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'rai//hud', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const SECRET = 'rk_' + 'live9f8e7d6c5b4a3f2e1d'

// A Windows repo at C:/work with a .env file, an open PR, and node on :3000
function setup(on, { answer = 'Deny', pr = true } = {}) {
  const clock = mock.clock(on)
  const asked: string[] = []
  on('session.start', () => ({ cwd: 'C:\\work' }))
  on('session.repo', () => ({ value: { root: 'C:/work', remote: 'git@github.com:me/r.git', internal: false } }))
  on('fs.list', ($, e) => ({
    value: /work$/.test(e.path) ? [{ name: '.env.local', kind: 'file', size: 10, isLink: false }] : [],
  }))
  on('fs.read', () => ({ value: 'RESEND_API_KEY=' + SECRET + '\nDEBUG=true\n' }))
  on('process.run', ($, e) => {
    const a = e.argv.join(' ')
    let stdout = ''
    let exitCode = 0
    let stderr = ''
    if (a.startsWith('git branch --show-current')) stdout = 'feat/x\n'
    else if (a.startsWith('gh pr view'))
      pr
        ? (stdout = JSON.stringify({ number: 42, title: 'Add auth', state: 'OPEN', reviewDecision: 'APPROVED', isDraft: false, url: 'https://github.com/me/r/pull/42' }))
        : ((exitCode = 1), (stderr = 'no pull requests found for branch "feat/x"'))
    else if (a.startsWith('gh pr checks')) {
      exitCode = 1
      stdout = JSON.stringify([
        { name: 'build', bucket: 'pass', workflow: 'ci' },
        { name: 'lint', bucket: 'fail', workflow: 'ci' },
        { name: 'e2e', bucket: 'pending', workflow: 'ci' },
      ])
    } else if (a.startsWith('netstat'))
      stdout = '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4242\r\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1\r\n'
    else if (a.startsWith('tasklist')) stdout = '"node.exe","4242","Console","1","90,000 K"\r\n"svchost.exe","1","Services","0","1 K"\r\n'
    return { value: { exitCode, stdout, stderr } }
  })
  for (const n of ['ui.toast', 'ui.blit', 'ui.close', 'command.register']) on(n, () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      asked.push(e.questions[0].question)
      return { result: { answers: { [e.questions[0].question]: answer } } }
    }
    return { result: 'ran' }
  })
  return { clock, asked }
}

async function start($, clock) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' })
  // Let the first CI and ports polls run
  await clock.advance(1000)
}

test('secret guard blocks a known key format in a file write', async ($, on) => {
  const { clock, asked } = setup(on)
  await start($, clock)
  const out = await $.tool.call({ tool: 'Write', file_path: 'C:/work/src/aws.ts', content: 'export const k = "AKIA' + 'Z'.repeat(16) + '"' })
  expect(out.deny).toMatch(/AWS access key/)
  expect(asked[0]).toMatch(/SECRET-GUARD :: AWS access key \(AKIA…ZZZZ\) headed for aws\.ts/)
})

test('secret guard catches a real .env value in code and in commands', async ($, on) => {
  const { clock, asked } = setup(on)
  await start($, clock)
  const edit = await $.tool.call({ tool: 'Edit', file_path: 'C:/work/src/mail.ts', old_string: 'x', new_string: 'const key = "' + SECRET + '"' })
  expect(edit.deny).toMatch(/value from your \.env/)
  const cmd = await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer ' + SECRET + '" https://api.resend.com' })
  expect(cmd.deny).toBeDefined()
  expect(asked.length).toBe(2)
})

test('secret guard leaves .env files and ordinary code alone', async ($, on) => {
  const { clock, asked } = setup(on)
  await start($, clock)
  expect(await $.tool.call({ tool: 'Write', file_path: 'C:/work/.env.local', content: 'KEY=AKIA' + 'Z'.repeat(16) })).toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Edit', file_path: 'C:/work/a.ts', old_string: 'a', new_string: 'const k = process.env.KEY' })).toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Bash', command: 'echo AKIA' + 'Z'.repeat(16) })).toEqual({ result: 'ran' })
  expect(asked).toEqual([])
})

test('ci tab shows the PR, review, and checks with failures first', async ($, on) => {
  const { clock } = setup(on)
  await start($, clock)
  await $.command.run({ command: 'hud', args: 'ci' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'tab-ci' })).toMatchObject({ props: { label: 'ci ✗1' } })
  expect(await ui.find({ type: 'Text', text: '#42 Add auth' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'approved' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'lint' })).toBeDefined()
  expect(await ui.find({ key: 'ci-open' })).toBeDefined()
})

test('ci tab says when the branch has no PR', async ($, on) => {
  const { clock } = setup(on, { pr: false })
  await start($, clock)
  await $.command.run({ command: 'hud', args: 'ci' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: '// no PR for feat/x' })).toBeDefined()
})

test('ports tab lists dev servers, not system ports', async ($, on) => {
  const { clock } = setup(on)
  await start($, clock)
  await $.command.run({ command: 'hud', args: 'ports' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'tab-ports' })).toMatchObject({ props: { label: 'ports 1' } })
  expect(await ui.find({ type: 'Text', text: ':3000' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'node' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'web' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ':135' })).toBeUndefined()
})

# rai-hud

A terminal-ops HUD for Claude Code. It makes no model calls and adds nothing to what Claude reads, so it costs zero tokens. The only text Claude ever sees from it is the reason when you deny a guard prompt.

Built to sit next to [ccstatusline](https://github.com/sirmalloc/ccstatusline), so it skips what that already shows (cwd, branch, context, model).

## What you get

**Mascot.** A pixel rottweiler in a hoodie at a laptop. The laptop screen and the dog react to what Claude is doing:

| State | When | Screen |
| --- | --- | --- |
| BOOT | a session starts | boot log and progress bar |
| THINKING | a turn starts | dots |
| SCANNING | Read, Glob, Grep | cyan magnifier over code |
| EDITING | Edit, Write | green code scrolling, sparks off the keys |
| EXEC | Bash, PowerShell | yellow `>_` with output |
| NET | WebFetch, WebSearch | magenta globe |
| ALERT | a guard is asking you | red `!`, the scene glitches |
| DONE / STOPPED | the turn ended / was interrupted | ✓ / ✗ |
| LEVELUP | you crossed an XP level | gold arrow |
| SLEEP | idle for 2 minutes | off, eyes closed, a z drifts up |

Matrix rain falls behind the dog while Claude works. The full scene needs a 60-column sidebar (2x from 120); narrower sidebars get a hand-built mini scene, and no room at all gets a one-line face.

The dog comes from `art/rottweiler.png` (a generated illustration, background removed). `python art/build_dog.py` turns it into the chunky pixel grids in `hooks/dogart.js`; the laptop, screen, eye and effects are drawn in code.

**Restyle.** Claude Code's own rows get the same look:

- tool calls: `[EDIT] src/auth.ts +12 -3 ✓`, `[EXEC] npm test …`, `[READ]`, `[GREP]`, `[NET ]`, `[MCP ]`… The diff or output still shows underneath
- folded reads and searches: `[SCAN] 3 reads · 2 greps ✓`
- your prompts: `rai@hud:~$ fix the auth bug`
- Claude's replies start with a `[rai]>` tag
- the spinner says `Injecting…`, `Tracing…`, `Escalating…` to match what's happening
- turns end with `[OK] op complete :: 41s · exec:6 · wr:2 · +18 XP` (`[SIGINT]` if you stopped it)
- the hint line adds your level, the footer says `guards armed`, and guard dialogs are headed `GIT-GUARD` / `SECRET`

`/hud style off` hands everything back to stock Claude Code.

**Sidebar tabs**

1. **tasks**: Claude's current plan
2. **files**: files changed this session with `+/-` line counts. `⧉` copies the path
3. **cmds**: last 8 shell commands with ✓ / ✗ / ⊘
4. **git**: ahead/behind, stashes, unpushed commits. `f` fetches
5. **ci**: the branch's PR, review state and checks via `gh`. `o` opens, `r` refreshes
6. **ports**: dev servers listening locally. `↗` opens in the browser

**Guards.** These hold the tool call and ask Authorize / Deny:

- **git guard**: push, force push, `reset --hard`, `clean -f`, commits on main/master
- **secret guard**: writes containing known key formats (AWS, GitHub, Anthropic, OpenAI, Stripe live, Google, Slack, Resend, private keys, DB URLs with passwords, Supabase service-role JWTs), or the real values from the repo's `.env*` files. Shell commands only trip on the real `.env` values.

Both skip `claude -p` runs, so scripts never hang on a dialog.

**XP and levels.** Each finished turn gives 5 XP + 1 per tool call + 3 per file edited. Ten titles from *script kiddie* to *the architect*, and the dog's outline color unlocks at levels 3, 5, 7 and 9 (green, purple, crimson, gold). Saved across sessions.

**Sounds.** Chime when a 15s+ turn finishes, siren on guard prompts, fanfare on level up. On Windows they play through PowerShell, since `$.audio` has no player there. Regenerate them with `python sounds/make_sounds.py`.

**Night mode.** Midnight to 5am: coffee mug, drowsy blinks, and a red `go to sleep` line.

**Also:** the spinner shows `▸ exec:4 wr:1` for the current turn.

## Keys and commands

| | |
| --- | --- |
| `Ctrl+↑` / `Ctrl+↓` | previous / next tab, from the prompt |
| `Ctrl+X` `Tab` | focus the sidebar; then `1`-`6` pick a tab |
| `/hud` | show or hide the sidebar |
| `/hud files` (or `git`, `ci`, `3`…) | jump to a tab |
| `/hud mute` | toggle sounds |
| `/hud style` (`on` / `off`) | toggle the restyle of Claude Code's rows |

The sidebar opens by itself in terminals 144+ columns wide. In a narrower one the mascot rides in the band until your first prompt, which places the sidebar at any width.

## Files

- `hooks/register.js`: events, sidebar, guards, restyle hooks
- `hooks/sprite.js`: the scene and its animation. Run `node preview.mjs` (or `node preview.mjs mini`) to see every state
- `hooks/dogart.js`: generated dog pixels; rebuild with `python art/build_dog.py`
- `hooks/style.js`: tool tags, verbs, and row formatting for the restyle
- `hooks/scan.js`: secret patterns and port parsing
- `art/`: the source illustration and its build script
- `sounds/`: WAV effects and the script that makes them
- `tests/`: `claude plugin test`

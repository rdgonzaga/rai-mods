# rai-mods

My [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview). Needs Claude Code 2.1.287 or later.

## Install

```
/plugin marketplace add rdgonzaga/rai-mods
/plugin install rai-hud@rai-mods
```

## Mods

| Mod | What it does |
| --- | --- |
| [rai-hud](plugins/rai-hud) | Hacker-themed HUD: pixel mascot, sidebar (tasks, files, cmds, git, CI, ports), git and secret guards, XP, sounds. Zero tokens. |

## Developing

Load a mod from its folder so edits hot-reload:

```
claude --plugin-dir ./plugins/rai-hud
```

Or set it for every session in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "C:\\path\\to\\rai-mods\\plugins\\rai-hud" } }
```

Check and test:

```
claude plugin validate ./plugins/rai-hud
cd plugins/rai-hud && claude plugin test
```

An installed copy is cached by version, so bump `version` in the plugin's `plugin.json` and in `.claude-plugin/marketplace.json` when you release.

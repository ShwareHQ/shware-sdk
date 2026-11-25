# @shware/skills

[Agent skills](https://agentskills.io) for building with the `@shware/*` packages: each one is a
`SKILL.md` that teaches a coding agent (Claude Code, Codex, Cursor, …) how to use the SDK the way
it is meant to be used. They are released with the SDK, so a skill changes in the same pull request
as the API it describes.

| Skill                         | Covers                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| `cursor-based-pagination-api` | Cursor-paginated list APIs and infinite-scroll clients (`@shware/http`) |
| `user-event-tracking`         | GA4-style event tracking and typed custom events (`@shware/analytics`)  |

The examples target `@shware/http` 4 and `@shware/analytics` 16. The package declares no peer
dependencies on them (changesets would turn every SDK release into a major release of this one),
so keep it up to date together with the SDK.

## Install

The skills ship in the package's `skills/` directory, the layout
[skills-npm](https://github.com/antfu/skills-npm) discovers. Install both at the workspace root
and link the skills from the `prepare` script:

```bash
pnpm add -Dw @shware/skills skills-npm
```

```json
{
  "scripts": {
    "prepare": "skills-npm -a codex"
  }
}
```

Every install then symlinks each skill into `.agents/skills/<name>` (relative links into
`node_modules`), and records them in `skills-npm-lock.json`; commit both. `-a codex` limits it to
`.agents/skills`, which Codex reads; for Claude Code, make `.claude/skills` a symlink to
`../.agents/skills`. Skills of your own in `.agents/skills` are left alone.

Updating is `pnpm up @shware/skills`: the links point into `node_modules`, so they pick up the new
content, and a skill added or removed in the release is linked or unlinked on that install.

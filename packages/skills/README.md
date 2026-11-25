# @shware/skills

[Agent skills](https://agentskills.io) for building with the `@shware/*` packages: each one is a
`SKILL.md` that teaches a coding agent (Claude Code, Codex, Cursor, …) how to use the SDK the way
it is meant to be used. They are released with the SDK, so a skill changes in the same pull request
as the API it describes.

| Skill                         | Covers                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `api-error-handling`          | Raising, validating and handling API errors with the error model (`@shware/http`)       |
| `cursor-based-pagination-api` | Cursor-paginated list APIs and infinite-scroll clients (`@shware/http`)                 |
| `subscription-purchase`       | Entitlements, catalogs, checkout and store webhooks (`@shware/purchase`)                |
| `user-event-tracking`         | Events, `trackOnce`, `identify` / `reset` and typed custom events (`@shware/analytics`) |

The examples target `@shware/http` 4, `@shware/analytics` 16 and `@shware/purchase` 11. The package declares no peer
dependencies on them (changesets would turn every SDK release into a major release of this one),
so keep it up to date together with the SDK.

## Install

The skills ship in the package's `skills/<name>/SKILL.md`. Install it at the workspace root:

```bash
pnpm add -Dw @shware/skills
```

### pnpm 12

pnpm links an approved dependency's skills into `.agents/skills` on install. Approve this one:

```bash
pnpm approve @shware/skills
```

That records the decision in `pnpm-workspace.yaml`; commit it:

```yaml
permissions:
  '@shware/skills':
    skills: true
```

- Every install then symlinks each skill into `.agents/skills/<name>` and lists the links in
  `.agents/skills/.gitignore` (between `# pnpm` markers), so they stay out of git.
- pnpm links only into an existing `.agents/skills`: create it (`mkdir -p .agents/skills`) and
  commit the `.gitignore` pnpm writes there, so a fresh clone gets the links on `pnpm install`.
- Codex reads `.agents/skills`. For Claude Code, make `.claude/skills` a symlink to
  `../.agents/skills`.
- Skills of your own in `.agents/skills` are left alone, and removing the package removes its
  links.

### npm, Yarn or older pnpm

Use [skills-npm](https://github.com/antfu/skills-npm), which discovers the same layout, from the
`prepare` script:

```bash
npm i -D @shware/skills skills-npm
```

```json
{
  "scripts": {
    "prepare": "skills-npm -a codex"
  }
}
```

`-a codex` links only into `.agents/skills`. The links and `skills-npm-lock.json` are meant to be
committed.

## Updating

`pnpm up @shware/skills` (or `npm update`). The links point into `node_modules`, so they pick up
the new content, and a skill added or removed in the release is linked or unlinked on that install.

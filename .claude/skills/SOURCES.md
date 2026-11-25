# Project skills: sources and licences

Installed at project level (this folder only). Each was reviewed before install:
licence checked, SKILL.md and scripts read. Files are unmodified copies, except
that `ui-ux-pro-max/scripts/tests/` was left out.

| Skill | Source | Commit | Licence | Notes |
|---|---|---|---|---|
| frontend-design | https://github.com/anthropics/skills (`skills/frontend-design`) | e4bb5d9 | Apache-2.0 | Text only, no scripts |
| ui-ux-pro-max | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill (`.claude/skills/ui-ux-pro-max`) | b73ee96 | MIT | Local Python search over bundled CSV data. No network, no subprocess. Writes files only with `--persist` / `--preview` |
| react-best-practices | https://github.com/vercel-labs/agent-skills (`skills/react-best-practices`) | 5a37a63 | MIT (README + SKILL.md; the repo has no LICENSE file) | Markdown rules only |
| motion-framer | https://github.com/freshtechbro/claudedesignskills (`.claude/skills/motion-framer`) | 1da73fe | MIT | Markdown plus two stdlib-only Python code generators and a starter app that is inert until `npm install` is run |

Reviewed but NOT installed (waiting for approval): taste-skill (Leonxlnx/taste-skill)
and the shadcn-ui MCP server (Jpisnice/shadcn-ui-mcp-server).

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
| design-taste-frontend (taste-skill 2.5.1) | https://github.com/Leonxlnx/taste-skill (`skills/taste-skill`, installed under its frontmatter name) | d1a2bb4 | MIT | Installed on the owner's explicit approval after a flagged review: it has a Stop hook that runs `node scripts/gate.mjs` when Claude finishes a reply (can block and force fix rounds), launches headless Chrome, and downloads icons (jsDelivr) and photos (Wikimedia Commons, picsum.photos). Needs Node 22+ and Chrome/Edge. 39 MB of assets |

Reviewed but NOT installed (waiting for approval): the shadcn-ui MCP server (Jpisnice/shadcn-ui-mcp-server).

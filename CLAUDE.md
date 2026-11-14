# CLAUDE.md

@AGENTS.md

AGENTS.md holds the real instructions, written for any agent; edit it, not
this. Claude Code-specific: `.claude/settings.json` pre-approves the commands
used constantly, denies reading the lockfile, and runs
`.claude/hooks/session-start.sh` to install dependencies on a web session.

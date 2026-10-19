---
description: Execute a functional browser command against the keyfarm jailed browser while maintaining the mirrored Playwright script.
argument-hint: <functional-command.md> [state-dir] [script.ts]
---

# keyfarm-maintain

Maintain `task.ts` as a deterministic Playwright mirror of the numbered steps in the functional command.

1. Read the functional command and its Success criteria.
2. If the profile is not authenticated, tell the user to run `nix run .#browser`, log in by hand, and close it. Never automate credentials.
3. Explore with replay_right's jailed Firefox. Prefer resilient role/text locators.
4. Keep each `// step N:` block aligned with the command; remove dead branches.
5. Run `nix run . -- --check-steps`, then verify only against an authorized target. Never weaken jail/profile isolation or solve captchas.
6. Report covered steps, ambiguities, and browser/authentication challenges.

A functional command is the source of intent; the script is its deterministic shadow. A final click is not success—require the command's explicit success indication.

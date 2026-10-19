# Contributor notes

- `commands/deviantart-publish.md` is the functional source of intent; keep its 12 numbered steps aligned with `publish.ts` and run `--check-steps`.
- Use `nix develop --command node --experimental-strip-types --test` and `nix flake check`.
- Do not automate login, weaken replay_right's jail, use a personal profile in tests, or make real DeviantArt submissions.
- stdout is reserved for result NDJSON. Send diagnostics to stderr.
- A `committing` receipt is an unknown external effect: never retry or remove it automatically.
- Do not add npm dependencies; Node stdlib, Playwright supplied by replay_right, and native browser behavior are sufficient.

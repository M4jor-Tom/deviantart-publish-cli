# deviantart-publish-cli

Standalone, website-specific DeviantArt scheduler. It uses [replay_right](https://github.com/M4jor-Tom/replay_right) for a jailed persistent Firefox and Playwright execution. It does not read Publicator data or write `publications.json`.

## Use

```sh
nix run .#browser                         # log in by hand; close Firefox afterward
printf '%s\n' '{"jobs":[]}' | nix run .
nix run . -- --headless < request.json
nix run . -- --state-dir /data/da-state < request.json
nix run . -- --browser firefox work < request.json
nix run . -- --check-steps
```

Publishing is headed by default. `--headless` is explicit. Without `--browser`, replay_right's jailed Firefox uses `<state-dir>/profile`; the default state dir is `.deviantart-publish` under the caller's current directory. A named Firefox profile is an explicit, unjailed replay_right override. The browser app also accepts `--state-dir DIR` or replay_right's `--browser firefox NAME`. Never test with a personal profile.

## NDJSON contract

stdin is one JSON request:

```json
{"jobs":[{"id":"opaque-id","imagePath":"/absolute/art.png","title":"Title","description":"Description","tags":["digitalart"],"schedule":{"timestamp":1800000000,"timezone":"Europe/Paris"},"price":5,"tiers":["Gold"],"galleries":["Landscapes"]}]}
```

`price`, `tiers`, and `galleries` are optional. PNG, JPEG, and GIF are accepted; WebP is rejected. The controller reads each image before browser startup and transfers bytes with Playwright's `FilePayload`, so the jailed browser receives no art-directory bind.

stdout contains one JSON result per attempted job, in order:

```json
{"id":"opaque-id","status":"scheduled","url":null}
{"id":"opaque-id","status":"failed","error":"pre-submission error"}
{"id":"opaque-id","status":"unknown","error":"submission may have succeeded; reconcile before retry"}
```

Diagnostics go to stderr. Processing stops at the first `failed` or `unknown`; later jobs have no output. Exit zero means all jobs succeeded (or the batch was empty), but callers must still validate every result line.

## Receipts and reconciliation

Receipts are atomically stored in `<state-dir>/receipts/<sha256-of-id>.json`. A `committing` receipt is synced immediately before the final Schedule click. A matching `scheduled` receipt is replayed without clicking again. An unresolved `committing` receipt returns `unknown`, and any receipt with a changed payload fingerprint is rejected.

Reconcile `committing` receipts deliberately:

1. Keep a backup and verify the deviation in DeviantArt itself.
2. If it is scheduled, atomically replace the receipt with status `scheduled` and `result` containing the same id plus the observed URL (or `null`), preserving `version`, `id`, and `fingerprint`.
3. If it definitely did not schedule, archive/remove that one receipt explicitly before retrying.

The publisher never clears uncertain receipts or stale `.publisher.lock` directories. Inspect their owner metadata and remove them only after proving no publisher process is running. Firefox profile locks are separate and are never modified here.

## Development and limits

```sh
nix develop --command node --experimental-strip-types --test
nix flake check
nix build
```

Nix supplies Node, Playwright Core, Firefox, and bubblewrap; there are no npm dependencies. The automated localhost fixture uses a disposable Firefox profile and makes no DeviantArt requests. The ported selectors and live authentication/success indications have **not** been verified against DeviantArt because this repository was built without credentials or authorization to submit artwork. PerimeterX or site markup changes may require updating the functional command and its mirrored implementation.

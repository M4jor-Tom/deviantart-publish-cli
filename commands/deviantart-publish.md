---
description: Schedule validated artwork on DeviantArt with the standalone publisher.
---

# DeviantArt publish

Use `deviantart-publish-cli` for normal execution. This command is the human-readable source of intent mirrored by `task.ts`; never automate credentials or bypass a challenge.

### Steps

1. Connect to www.deviantart.com
2. Click on submit
3. Click on "upload your art" and pick file `<job.imagePath>`
4. Set as title `<job.title>`
5. Set as description `<job.description>`
6. Tick boxes "Mature" and "Created using AI tools"
7. Drop all the pre-filled tags in the "Tags" field
8. Add `<job.tags>` to the "Tags" field
9. If the piece has a price, tick "Sell as Premium Download" and set the price
10. Set the subscription tiers `<job.tiers>`
11. Add to galleries `<job.galleries>`
12. Schedule publication for `<job.schedule>`

### Success criteria

The site shows an explicit scheduled-success indication. A click alone is not success.

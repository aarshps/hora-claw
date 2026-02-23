---
description: Versioning and release guidelines for agents modifying the repository
---

# Release Versioning

Every agent finishing a set of code changes or updates MUST bump the release version before committing and pushing.

## The Versioning Rule

1. Always run `npm run release:bump -- <new_version> "<highlight 1>" "<highlight 2>"`
2. `<new_version>` should be strictly higher than the current version in `package.json` (use semver).
3. The highlights should summarize the core changes made to the repo during your session payload.
4. ONLY bump right before generating the final commit for your current task.
5. NEVER commit changes to `index.js`, `README.md`, or other core files without also including a `package.json` and `release-notes.json` version bump in the same or immediately subsequent commit.

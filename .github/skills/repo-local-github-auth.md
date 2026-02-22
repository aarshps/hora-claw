---
description: Keep Git and gh CLI identity scoped to this repository only
---

# Repo-Local GitHub Auth

When multiple GitHub accounts exist, keep this repo isolated from global credentials.

## Git Identity Scope

1. Set `user.name` and `user.email` in local repo config only (`git config --local ...`).
2. Set `credential.https://github.com.username` locally to the intended account.
3. Do not modify global Git identity unless explicitly requested.

## gh CLI Scope

1. Store repo-scoped gh auth inside `.git/gh` (never tracked by Git).
2. Use local credential helper pointing at repo-scoped gh config:
3. `credential.helper = !f() { GH_CONFIG_DIR="$(git rev-parse --git-dir)/gh" gh auth git-credential "$@"; }; f`
4. Avoid using repo-root `.gh` directory to prevent accidental commits.

## Shell Behavior

1. Optional shell hook may set `GH_CONFIG_DIR` only while inside this repo path.
2. Ensure hook unsets `GH_CONFIG_DIR` when leaving repo.
3. Keep hook idempotent and guarded to avoid duplicate registration.

## Verification

1. In repo: `gh api user --jq .login` should return repo account.
2. Outside repo: same command should return global/default account.
3. `git credential fill` for github.com in repo should yield repo account username.

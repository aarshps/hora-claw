---
description: Standards for writing and maintaining agent skills
---

# Agent Skills Standard

The `.github/skills` folder stores repo-specific execution patterns for future coding agents.

## Core Rules

1. Max length is a hard limit: each skill file must be 100 lines or fewer, including frontmatter and blank lines.
2. Every skill file must include YAML frontmatter with at least `description`.
3. Keep each file focused on one concept. Split unrelated guidance into separate skills.
4. Write only repository-specific behavior, failure modes, constraints, and safe defaults.
5. Prefer actionable checklists over theory. Agents should be able to execute directly from the skill.
6. Record known failure signatures and exact mitigations where possible.
7. When architecture changes, update or remove stale skills in the same PR.
8. If a rule conflicts with code reality, update the skill to match code after fixing code.

## Naming and Layout

1. Use lowercase, hyphenated filenames (example: `status-broadcast-delivery.md`).
2. Keep one top-level heading per file and short sections below it.
3. Avoid duplicated guidance across skills; link conceptually by filename in text if needed.

## Required Verification

Before committing skill changes, run:

```bash
for f in .github/skills/*.md; do
  lines=$(wc -l < "$f")
  if [ "$lines" -gt 100 ]; then
    echo "FAIL: $f has $lines lines (max 100)"
  fi
done
```

If any file fails, shorten it before merge.

---
description: Standards for writing and maintaining agent skills
---

# Agent Skills Standard

Welcome to the `.github/skills` directory. This folder contains specialized knowledge patterns (skills) meant to be read by Agentic AI instances to help them maintain and extend this repository consistently.

## Core Rules

1. **Max Length**: Every skill file MUST NOT exceed 100 lines of text. Be concise, direct, and rely on code snippets only when absolutely necessary.
2. **Format**: Each skill must include YAML frontmatter with a `description`.
3. **Context**: Focus on the *why* and the *gotchas* of the codebase, not basic tutorial information. Assume the reader is an advanced AI agent.
4. **Scope**: One pattern or concept per file. Do not merge unrelated concepts into a single massive document.
5. **Updates**: When system architecture changes, existing skills must be updated or deprecated. Do not let documentation rot.

# Agent skills

A small collection of reusable, reader-first skills for coding agents.

## Skills

### [reader-review](skills/reader-review/SKILL.md)

An editorial reviewer for **human-facing documents, interfaces, and landing pages**. It removes true but irrelevant details, repairs the order in which ideas unfold, and matches explanation depth to the reader's needs.

Unlike a word-count optimizer, it protects essential caveats, decision-critical information, factual precision, examples, and author voice. UI reviews account for non-linear navigation and individual screen states.

The reviewer prefers a fresh-context subagent to reduce bias from earlier drafts and brainstorming. If delegation is unavailable, it reviews inline.

## Install for Codex (global)

```bash
npx skills add yernende/agent-skills --skill reader-review -a codex -g -y
```

The global installation makes the skill available across your repositories.

Use it explicitly:

```text
$reader-review Review this document for its intended audience and edit it.
```

For a **default review pass after user-facing UI copy changes**, add the following instruction to `~/.codex/AGENTS.md`:

```markdown
- After creating or changing user-facing UI or landing-page content, run $reader-review once before handoff. For documents, use it only on an explicit editorial request. Skip code-only changes and routine ADRs unless asked.
```

This is an agent instruction, not a programmatic hook. Installing the skill alone does not guarantee automatic invocation.

Update your global installation:

```bash
npx skills update reader-review -g
```

## License

[MIT](LICENSE)

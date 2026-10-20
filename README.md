# Agent skills

A small collection of reusable, reader-first skills for coding agents.

## Skills

### [reader-review](skills/reader-review/SKILL.md)

An editorial reviewer for **human-facing documents, interfaces, and landing pages**. It removes true but irrelevant details, repairs the order in which ideas unfold, and matches explanation depth to the reader's needs.

Unlike a word-count optimizer, it protects essential caveats, decision-critical information, factual precision, examples, and author voice. UI reviews account for non-linear navigation and individual screen states.

The reviewer prefers a fresh-context subagent to reduce bias from earlier drafts and brainstorming. If delegation is unavailable, it reviews inline.

### [browser-video-qa](skills/browser-video-qa/SKILL.md)

Verify a browser feature and choose **video, slideshow, or both**. Both formats follow planned key states: slides show those states; continuous video also shows the transitions and pauses at each result. The agent checks the user journey, reloads saved results when relevant, and inspects the finished media. Recordings include a visible cursor, click indicators, and readable captions. Stills are clearly labelled and do not establish smoothness or transient behavior.

Includes small helpers for Playwright overlays and FFmpeg processing. Uses an existing browser runtime; no application dependency upgrade is required. Desktop capture and generated narration are outside this version.

```bash
npx skills add yernende/agent-skills --skill browser-video-qa -a codex -g -y
```

```text
$browser-video-qa Проверь сохранение положения двери после перезагрузки и покажи короткое видео с курсором.
$browser-video-qa Проверь тот же сценарий, но сделай только слайд-шоу с ключевыми состояниями.
```

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

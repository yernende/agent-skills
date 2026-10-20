---
name: reader-review
description: Review wording and reading flow during user interface or landing-page design, or on an explicit request for reader/editorial review. Do not activate for ordinary documentation, README/runbook/ADR updates, code changes, or task summaries.
---

# Reader review

## Invocation scope

Apply automatically only during user interface or landing-page design. For documents and all other material, apply only when the user explicitly requests reader/editorial review or invokes `$reader-review`.

Writing, updating, or committing documentation, README files, runbooks, ADRs, code comments, or task summaries is not a request for this review. If neither condition is met, skip this skill without reviewing or delegating.

## Run

- Establish the reader, their goal and existing knowledge, medium, authoritative facts, constraints, and editable scope. Infer what is clear; clarify only consequential ambiguity. Keep this brief and internal.
- As coordinator, use one fresh-context subagent when supported. Send this skill, the current artifact with available layout/states, and the brief. Omit brainstorming, previous drafts, and author justifications. Request revised text or a focused diff; apply accepted edits within scope. If delegation is unavailable, review inline and identify it as an inline pass.
- When assigned the review, perform it directly; do not delegate again.

## Review

1. Keep a detail when it serves this reader's understanding, decision, action, or intended experience. Remove irrelevant truths, authoring notes, unsolicited reassurances, discarded alternatives, filler, and repetition unless they have a concrete reader purpose. Express relevant implementation through its consequences at the reader's level.
2. For documents, follow the reader's questions and conceptual dependencies. Introduce what later passages rely on. Match the sequence to the genre. Keep depth appropriate to the current question; bridge necessary shifts and move useful optional detail to where it becomes relevant.
3. For UI, inspect tasks, entry points, screens, and states rather than assuming sequential reading. Make labels and next actions clear. Add explanation only for a concrete ambiguity or consequence. Keep decision-critical information visible before the action and preserve accessible labels. Use existing disclosure for optional detail; delete irrelevant copy instead of hiding it. Assess visual hierarchy when available.
4. Preserve meaning, evidence, qualifications, uncertainty, and consequential limitations. A negative statement can be essential. Never improve apparent clarity by strengthening a claim or inventing facts, benefits, or behavior. Flag unresolved factual ambiguity instead of silently deleting it.
5. Preserve the artifact's language, voice, useful examples, and specificity. Make the smallest sufficient changes; reorder substantially when needed. Optimize reader effort, not minimum word count. Leave effective content unchanged.

## Finish

Reread affected context once for missing links, changed claims, and broken references. For UI edits, check the rendered result when available; state any material inspection limit. Stop unless a concrete defect remains.

Return the revised artifact or focused diff and at most three substantive notes. If asked only for an audit, return located findings with proposed wording and do not edit files. Keep review commentary out of the artifact.

---
name: reader-review
description: Review wording and reading flow during UI or landing-page design and when drafting, editing, or publishing professional profiles (LinkedIn, HH), resumes, portfolios, and their media captions. Also use on an explicit reader/editorial review request. Do not activate for ordinary documentation, README/runbook/ADR updates, code changes, or task summaries.
---

# Reader review

## Invocation scope

Apply automatically during user interface or landing-page design and when drafting, editing, or publishing professional profiles (including LinkedIn and HH), resumes, portfolios, and their media captions. For other material, apply only when the user explicitly requests reader/editorial review or invokes `$reader-review`.

Writing, updating, or committing ordinary documentation, README files, runbooks, ADRs, code comments, or task summaries is not a request for this review. If no invocation condition is met, skip this skill without reviewing or delegating.

## Run

- Establish the reader, their goal and existing knowledge, medium, authoritative facts, constraints, and editable scope. Distinguish the artifact's audience from the user receiving the agent's work report. Infer what is clear; clarify only consequential ambiguity. Keep this brief and internal.
- As coordinator, use one fresh-context subagent when supported. Send this skill, the current artifact with available layout/states, and the brief. Omit brainstorming, previous drafts, and author justifications. Request revised text or a focused diff; apply accepted edits within scope. If delegation is unavailable, review inline and identify it as an inline pass.
- When assigned the review, perform it directly; do not delegate again.

## Review

1. Keep a detail when it serves this reader's understanding, decision, action, or intended experience. Remove irrelevant truths, authoring notes, unsolicited reassurances, discarded alternatives, filler, and repetition unless they have a concrete reader purpose. Express relevant implementation through its consequences at the reader's level.
2. For documents, follow the reader's questions and conceptual dependencies. Introduce what later passages rely on. Match the sequence to the genre. Keep depth appropriate to the current question; bridge necessary shifts and move useful optional detail to where it becomes relevant.
3. For UI, inspect tasks, entry points, screens, and states rather than assuming sequential reading. Make labels and next actions clear. Add explanation only for a concrete ambiguity or consequence. Keep decision-critical information visible before the action and preserve accessible labels. Use existing disclosure for optional detail; delete irrelevant copy instead of hiding it. Assess visual hierarchy when available.
4. Preserve meaning, evidence, qualifications, uncertainty, and consequential limitations. A negative statement can be essential. Never improve apparent clarity by strengthening a claim or inventing facts, benefits, or behavior. Flag unresolved factual ambiguity instead of silently deleting it.
5. Preserve the artifact's language, voice, useful examples, and specificity. Make the smallest sufficient changes; reorder substantially when needed. Optimize reader effort, not minimum word count. Leave effective content unchanged.

## Public copy and work reports

- For professional profiles and portfolios, describe the project, visible functionality, and the user's contribution. Review titles, captions, image descriptions, and alt text as part of the artifact, not as incidental upload metadata.
- Keep preparation and verification details in the private report to the user. Do not add unsolicited public notes about archive retrieval, local restoration, translation, localization, AI editing, capture tools, or checks merely to document the agent's process or reassure the reader. A fact being true does not make it useful public copy. An instruction to explain the work to the user does not authorize inserting that explanation into the artifact.
- Include provenance or methods when the user explicitly requests them in the artifact or they serve the reader's actual task. Preserve qualifications essential to a truthful claim. If preparation changed what an image appears to demonstrate, flag the issue privately before publication and resolve the representation; do not conceal it or invent a capability.
- Example: a CMS image caption can read "React CMS — Markdown editing and article layout controls." Remove an unsolicited addition such as "Recovered from an archive; interface labels translated for this screenshot." An accessibility description should explain what the image shows.

## Finish

Reread affected context once for missing links, changed claims, and broken references. For UI edits, check the rendered result when available; state any material inspection limit. Stop unless a concrete defect remains.

Before publication or handoff, inspect the exact final reader-facing fields, including media captions and descriptions. For each added sentence, identify the reader need it serves; remove sentences whose only purpose is to explain the agent's workflow. Apply this check to any copy added after the review, so upload-time additions cannot bypass it. Keep verification notes in the report to the user.

Return the revised artifact or focused diff and at most three substantive notes. If asked only for an audit, return located findings with proposed wording and do not edit files. Keep review commentary out of the artifact.

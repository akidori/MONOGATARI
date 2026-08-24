# Personal Work OS integration contract

## Purpose

Personal Work OS changes how instructions are presented. It does not change deadlines, quality standards, permissions, facts, source Q&A, or approval boundaries.

The first implementation is the editor coach shown on `share.html` when an editor upload token is present.

## MVP modes

- `simple`: show the next single action first
- `checklist`: show all actions and completion state
- `structure`: show the purpose and reason before the actions

Every mode keeps links to:

- project-specific rules
- the uncompressed source Q&A or transcript
- the detailed manual and its reasoning

## Client-side MVP

The editor can select a mode in the coach. The choice is stored locally under:

```text
mg:workstyle:manual-display
```

A mode can also be initialized with a URL parameter:

```text
share.html?...&guide=simple
share.html?...&guide=checklist
share.html?...&guide=structure
```

## Future Studio OS payload

Studio OS may later provide a user-owned profile in the shared project payload:

```json
{
  "personalWorkOs": {
    "version": 1,
    "manual_display": "checklist",
    "reason_visibility": "on_demand",
    "review_display": "timestamp_then_reason",
    "instruction_granularity": "step_by_step",
    "updated_by": "user",
    "confidence": 1
  }
}
```

Precedence in the UI:

1. `guide` URL parameter for an explicit session override
2. the editor's locally saved choice
3. Studio OS profile included in the project payload as a default
4. `checklist` default

## Safety and data rules

- Do not infer ability, role suitability, compensation, or access from personality data.
- Do not weaken deadlines or quality requirements by profile.
- Do not replace source material with a summarized presentation.
- Do not hide source Q&A, reasons, exceptions, or unresolved markers.
- Let the user inspect and change their own presentation preference.
- Prefer observed, user-correctable work preferences over MBTI labels.

## Ownership

- Studio OS: user profile, project, assignee, deadline, current phase
- MONOGATARI: scripts, scenes, materials, editing decisions, contextual presentation
- Obsidian: source transcript, full Q&A, reasons, supporting information
- Haruka: conversational delivery using the same presentation profile

# Event Storming Board — Project & Moderator Guide

This is a local workshop tool. Participants bring domain knowledge; the agent
helps them discover, structure and question it. Use `board.json` as the persisted
artifact, and the revision-checked API as the only write path during live work.
`CLAUDE.md` is a symlink to this file.

## Start or resume

- Read the current board. **Resume by default. Never reset simply because a new
  chat or agent session started.** A code review or implementation task is not a
  workshop kickoff. When discussing the workshop application, remain at the product
  level: do not ask for a workshop domain or start facilitation unless requested.
- For an explicitly requested new workshop, archive the existing board first
  (`archive: true` in the API request, or the browser's New workshop action).
- Establish purpose, scope and relevant participants. The human controls domain
  decisions and workshop advancement. Ask one focused question at a time.
- Invite independent contributions before assembling an authoritative story.
  When examples help, offer 2–4 suggestions and mark them `status: "suggested"`,
  `source: "AI"`. Do not confirm an AI suggestion without participant evidence.
- Preserve disagreements, uncertainty and alternative explanations. Do not turn
  absence of knowledge into invented business rules.

## Safe live edits

Run with Node 24 LTS: `npm start`, open `http://127.0.0.1:4000`.
The server binds only to loopback; it is not an authenticated remote service.
Use one server per board on one configured port. There are no persistent lock
files; repeated startup reuses the existing URL. Do not run the same board on
multiple ports, because those processes would bypass single-writer coordination.

1. Read a fresh envelope into a new temporary draft:
   `node scripts/board.js get /tmp/workshop-draft.json`
2. Edit only its `board` property. Preserve its original `revision`, unrelated
   fields, item IDs, participant wording and positions. The draft contains
   `{board, revision, sequence, instance, warning}`.
3. Commit: `node scripts/board.js put /tmp/workshop-draft.json`.
4. On HTTP 409, retain the draft, read a fresh envelope to a different file,
   compare changes, and reapply only noncompeting intended edits. Ask the human
   about competing domain edits. **Never replace a stale draft's revision with
   the newest revision merely to force a write.**
5. Report what changed and ask the next focused workshop question.

The CLI also supports `history` and `restore request.json`; restore requires
`name` and `expectedRevision`. Ask before replacing shared work. Both new
workshop and restore archive the prior valid board.

Direct `board.json` editing is supported for **offline editing only**, with the
server stopped. Legacy live disk changes are detected and validated but cannot
participate in the write lock; they are not safe concurrent edits. Reading a
file before writing does not prevent a race with another writer.

## Artifact schema

`public/model.js` is the shared vocabulary, validation and merge implementation.
The legacy board schema remains readable, with a purpose inferred in memory.
Existing IDs and positions are preserved. Never hand-set `updatedAt`.
`workshopId` identifies the workshop across revisions. Preserve it while editing;
use a new UUID when explicitly starting a new domain workshop. Legacy boards
receive `legacy` in memory. The browser's New workshop action handles this.

```json
{
  "title": "Event Storming — Checkout",
  "purpose": "big-picture",
  "phase": "chaotic-exploration",
  "notes": "Scope, participants, decisions, assumptions, owners and next steps",
  "items": [
    { "id": "evt-unique-id", "role": "event", "text": "Order placed", "x": 320, "y": 330,
      "status": "suggested", "source": "AI" }
  ]
}
```

Items require unique stable `id`, known `role`, string `text`, finite nonnegative
`x` and `y`. Optional fields: `width`, `height`, `fontSize` (annotations), legacy
hex `color`, `status` (`suggested`/`confirmed`), `source`, `priority`
(`high`/`medium`/`low`), `owner`, `nextStep`, `invariant`, `termination`, `frameId`.
Missing status means unreviewed, not confirmed. Keep role colors intact.

A `frame` has `frameKind`: `scenario`, `conversational`, `context` or `aggregate`.
Assign non-frame members with `frameId`; dragging a frame moves those members.
Frames do not nest. A frame is an explicit grouping, not a claim that a boundary
has been proven. Document supporting rules/evidence. Labels are free annotations.

## Grammar and facilitation

| Role | Color | Meaning |
| --- | --- | --- |
| event | orange | Business-relevant occurrence in past tense; one idea per sticky |
| hotspot | red | Uncertainty, disagreement, risk, pain or opportunity |
| command | blue | Intent in imperative form; may be rejected or produce several events |
| actor | yellow | Business person/role making a decision or expressing intent |
| readmodel | green | Information needed to make that decision |
| policy | purple | Whenever an event occurs, a rule reacts and may issue a command |
| external | pink | System outside the chosen domain boundary |
| aggregate | tan | Candidate consistency boundary justified by invariants, not just an entity |
| label/frame | neutral | Annotation, scenario, repeated activity or candidate boundary |

Events can be triggered by people, policies, external occurrences or elapsed
time. Do not invent a human actor for automation. Name automated behavior as a
policy or external interaction according to the chosen scope. Don't force a
one-command/one-event relationship.

Layout follows the workshop goal automatically: Big Picture uses a free canvas;
Process Modelling and Software Design use adaptive role lanes.
They place unframed cards in expanding role rows, stack overlapping cards without
changing narrative X, and push later lanes down. Switching to Big Picture restores
the authored positions. Scenario frames retain internal geometry below the role lanes.
Exploration starts freely. Later, left-to-right is narrative order, not proof
of causality or a proportional clock. Use separate frames for alternatives and
parallel activity. Use conversational frames for repeated/nonsequential behavior,
and ask which event or condition terminates it. Keep useful spacing without
restructuring participants' work without agreement.

## Purpose and steps

- **Big Picture:** `chaotic-exploration` → `timeline` → `hotspots` → `closure`.
  Explore multiple perspectives, pivotal events, chronology, problems and
  opportunities. Aggregates are not a mandatory outcome.
- **Process Modelling:** `timeline` → `hotspots` → `commands-actors` →
  `models-policies` → `closure`. Investigate a selected flow, decisions,
  normal/alternative/failure scenarios, retries, timeouts and termination.
- **Software Design:** process steps plus `aggregates` before `closure`.
  Establish invariants and responsibilities before candidate aggregate and
  bounded-context boundaries. A bounded context concerns language/model scope;
  it is not merely a collection of entities.

Steps guide the moderator's discussion; participants do not select steps in the UI.
The phase metadata remains available for compatibility and moderator context, but
never gates the toolbar. Workshop goals determine the available notation and layout.
Big Picture offers events, hotspots, annotations and frames. Process Modelling adds
actors, commands, read models, policies and external systems. Software Design also
adds aggregates and consistency guidance. Existing cards remain visible in every
mode. Do not add layout toggles or configuration controls when a goal supplies a
reasonable default. Notes, export, recovery and new-workshop actions live under
Workshop options.

Finish with prioritized hotspots, decisions and open assumptions. Give each
important unresolved question an owner and next action. Keep the artifact
available for follow-up; a full palette is not a success criterion.

## Engineering

- `server.js`: loopback HTTP/SSE, request boundaries, revision-checked commits.
- `lib/store.js`: validation, atomic persistence, one watcher with polling
  fallback, last-good recovery and bounded snapshots.
- `public/model.js`: shared schema, workshop vocabulary and three-way merge.
- `public/sync.js`: pending drafts, acknowledgements, conflicts, undo and recovery.
- `public/app.js`: DOM canvas, editor, frames, accessible interaction and lifecycle.
- `public/layout.js`: derived adaptive lanes; never writes layout changes to the board.
- `scripts/board.js`: agent/client CLI through the same API.

Run `npm run verify` for syntax, model, sync and real HTTP/filesystem tests.
Browser tests: `npm ci`, `npx playwright install chromium`, `npm run test:browser`.
Tests use temporary boards; never exercise destructive tests on `board.json`.
Keep the zero runtime dependency architecture. Dev-only browser tooling is fine.
Do not expose `.board-history` as static content or commit private snapshots.

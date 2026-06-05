# Event Storming Board — Project & Agent Guide

This repo is a **live Event Storming workshop tool**. A human facilitates in the
browser; **you (Claude) act as the Event Storming moderator** by editing
`board.json`. The browser re-renders the board instantly on every file change.

> `CLAUDE.md` is a symlink to this file for tools that look for that name.

---

## 1. Architecture

```
        POST /api/board                 fs.watch + SSE
browser ───────────────▶ board.json ──────────────────▶ browser(s)
                            ▲
        you edit the file ──┘
```

- `server.js` — zero-dependency Node HTTP server. Serves `public/`, exposes
  `GET/POST /api/board` and an SSE stream at `/api/stream`, and `fs.watch`es
  `board.json`, pushing every change to all connected browsers.
- `board.json` — **the single source of truth.** Both writers touch it: the
  human (browser → POST) and you (editing the file directly).
- `public/` — the client. `app.js` holds the Event Storming model (roles, lanes,
  phases); `style.css` the visuals; `index.html` the shell.

Run with `node server.js`, open `http://localhost:4000`.

**The board is the only state.** There is no database and no session history —
see §5.

---

## 2. `board.json` schema

```jsonc
{
  "title": "Event Storming — Checkout",   // shown in the header
  "phase": "chaotic-exploration",         // current workshop phase (see §4)
  "items": [
    { "id": "evt-1", "role": "event", "text": "Order Placed", "x": 320, "y": 330 }
  ]
}
```

Every item:

| field            | required | notes                                                            |
| ---------------- | -------- | ---------------------------------------------------------------- |
| `id`             | yes      | unique, stable. Convention: `<role>-<n>` e.g. `evt-7`, `cmd-3`.  |
| `role`           | yes      | one of the roles in §3 (or `label`).                             |
| `text`           | yes      | the sticky's words.                                              |
| `x`, `y`         | yes      | pixels from board top-left. `x` = time, `y` = lane (see §3).     |
| `width`/`height` | no       | override the role default.                                       |
| `color`          | no       | override the role color (avoid — color *is* meaning here).       |
| `fontSize`       | no       | `label` role only.                                               |

Keep the JSON valid — a malformed file is ignored until the next good save.
Don't hand-set `updatedAt`; the server stamps it.

---

## 3. The Event Storming grammar (roles, colors, lanes)

Color is meaning. Each role has a fixed color and a **home lane** (a default `y`).
Place stickies in their lane and the board reads correctly top-to-bottom.

| role        | color  | meaning                                   | home `y` | text style                          |
| ----------- | ------ | ----------------------------------------- | -------- | ----------------------------------- |
| `actor`     | yellow | a person/role who triggers a command      | 92       | the role name ("Customer")          |
| `command`   | blue   | an intent/action that causes an event     | 200      | imperative ("Place Order")          |
| `event`     | orange | something that happened — the spine       | 330      | **past tense** ("Order Placed")     |
| `hotspot`   | red    | problem, risk, conflict, open question    | 338      | a question or pain ("Payment fails?")|
| `readmodel` | green  | info an actor needs to decide             | 458      | a view ("Cart Summary")             |
| `policy`    | purple | reactive rule: *whenever X then Y*        | 586      | "Whenever order placed → reserve…"  |
| `external`  | pink   | system outside the domain                 | 716      | a system name ("Payment Gateway")   |
| `aggregate` | tan    | the entity that enforces rules            | 568      | a noun ("Order", "Cart")            |
| `label`     | —      | free heading (bounded-context names etc.) | free     | short title                         |

**The X axis is time.** Domain events flow left → right in the order they occur.
Keep a roughly **180–200px horizontal gap** between consecutive events so there's
room for the commands/actors above and read models/policies below them.

The browser draws the lanes, the timeline spine, the legend, and a phase-gated
toolbar automatically from these same definitions (`ROLES` / `LANES` / `PHASES`
in `app.js`). If you add a new role, update `app.js` too.

---

## 4. The phase flow

`board.phase` drives the workshop. Each phase **unlocks the roles the human's
toolbar can add**, so the method is enforced by the UI. Advance phases
deliberately, and only when the current one is "full enough."

1. `chaotic-exploration` — diverge on **domain events** (orange), past tense, unordered.
2. `timeline` — order events left → right; merge duplicates; surface gaps.
3. `hotspots` — mark problems/questions with **red** hotspots on the timeline.
4. `commands-actors` — add the **command** (blue) that causes each event and the **actor** (yellow) who issues it.
5. `models-policies` — add **read models** (green), **policies** (purple, "whenever…"), **external systems** (pink).
6. `aggregates` — cluster commands+events around **aggregates** (tan); name **bounded contexts** with labels.

When you move the workshop forward, set `board.phase` in the file — the browser's
phase selector and guidance follow.

---

## 5. Your role as moderator

You are the facilitator, not just an editor. Be concise, ask sharp questions, and
keep the board moving. The participant drives the domain; you structure it.

### Start of every session (no history — always from scratch)

There is **no persisted session**. Do not assume any prior board or conversation.
At the start of a workshop:

1. **Reset the board** to the clean starter:
   ```json
   { "title": "Event Storming", "phase": "chaotic-exploration", "items": [] }
   ```
2. Briefly introduce Event Storming (one or two sentences) and **ask what
   business process or domain we're exploring** (e.g. checkout, onboarding,
   claims). Set `title` to `Event Storming — <domain>` once you know it.
3. Begin Phase 1: seed **2–4 example domain events** to model the format, then
   invite the participant to add more (in the browser or by asking you).

If the user opens with a domain already, skip the question and go straight to
seeding events.

### While facilitating

- **Edit `board.json` to think out loud on the board.** Add/rename/move stickies,
  cluster them, drop hotspots where you see risk or ambiguity.
- **Respect the current phase.** Don't pour in commands/policies during chaotic
  exploration. Match what you add to `board.phase`, and announce when you advance.
- **Honor the conventions in §3**: events past tense, commands imperative, one
  idea per sticky, place each role in its lane, keep the event gap ~180–200px.
- **Use unique, readable ids** (`evt-12`, `cmd-4`, `pol-2`). Never reuse an id.
- **Don't clobber the human's work.** Read `board.json` before editing so you
  build on the latest state (they may have added/moved stickies live). Edit
  surgically; preserve their items, ids, and positions.
- **Ask before destructive moves.** Don't wipe or restructure the whole board
  unless the user asks (resetting at session start is the exception).
- After a change, tell the user in chat what you did and what to do next ("Added
  3 events through 'Order Shipped' — what happens if payment fails?").

### Good moderator habits

- Hunt for the edges: failure paths, retries, timeouts, cancellations.
- Convert vague statements into hotspots ("not sure who approves" → red sticky).
- When events bunch up or stretch thin, that's a signal — point it out.
- Keep momentum: small, frequent edits beat one giant rewrite.

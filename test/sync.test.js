const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Sync } = require("../public/sync");
const { starter, clone } = require("../public/model");
const event = (id) => ({
  id,
  role: "event",
  text: "Order placed",
  x: 40,
  y: 330,
});
const state = (board, sequence = 1) => ({
  board,
  revision: String(sequence),
  sequence,
  instance: "test",
});
function setup(request) {
  const sync = new Sync({ request });
  sync.receive(state({ ...starter(), items: [event("a")] }));
  return sync;
}
test("SSE retains pending local edits and combines an independent participant addition", () => {
  const sync = setup();
  sync.edit((b) => (b.items[0].text = "Local pending"));
  const remote = clone(sync.base);
  remote.items.push(event("b"));
  sync.receive(state(remote, 2));
  assert.equal(sync.draft.items[0].text, "Local pending");
  assert.equal(sync.draft.items.length, 2);
  assert.ok(sync.dirty);
});
test("HTTP failure is not saved and local work survives", async () => {
  const sync = setup(async () => ({
    ok: false,
    status: 500,
    body: { error: "Disk full" },
  }));
  sync.edit((b) => (b.title = "Unsaved title"));
  assert.equal(await sync.save(), false);
  assert.equal(sync.status, "Save failed");
  assert.match(sync.error, /Disk full/);
  assert.ok(sync.dirty);
});
test("edits during in-flight save remain dirty after its acknowledgement", async () => {
  let finish;
  const sync = setup(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  sync.edit((b) => (b.title = "First"));
  const sent = clone(sync.draft);
  const pending = sync.save();
  sync.edit((b) => (b.items[0].text = "Second"));
  finish({ ok: true, status: 200, body: state(sent, 2) });
  await pending;
  assert.equal(sync.base.items[0].text, "Order placed");
  assert.equal(sync.draft.items[0].text, "Second");
  assert.ok(sync.dirty);
});
test("409 rebases independent edits instead of silently overwriting", async () => {
  const remote = {
    ...starter(),
    title: "Agent title",
    items: [event("a"), event("b")],
  };
  const sync = setup(async () => ({
    ok: false,
    status: 409,
    body: state(remote, 2),
  }));
  sync.edit((b) => (b.items[0].x = 250));
  await sync.save();
  assert.equal(sync.draft.title, "Agent title");
  assert.equal(sync.draft.items[0].x, 250);
  assert.equal(sync.draft.items.length, 2);
  assert.equal(sync.conflicts.length, 0);
});
test("competing changes pause saving until resolved; newer remote work is retained", async () => {
  let writes = 0;
  const sync = setup(async () => {
    writes++;
  });
  sync.edit((b) => (b.items[0].text = "Local"));
  const remote = clone(sync.base);
  remote.items[0].text = "Remote";
  sync.receive(state(remote, 2));
  await sync.save();
  assert.equal(writes, 0);
  remote.items.push(event("b"));
  sync.receive(state(remote, 3));
  sync.resolve("a.text", "remote");
  assert.equal(sync.conflicts.length, 0);
  assert.equal(sync.draft.items[0].text, "Remote");
  assert.equal(sync.draft.items.length, 2);
});
test("remote deletion during editing is deferred and becomes a conflict on release", () => {
  const sync = setup();
  sync.hold();
  sync.receive(state({ ...starter(), items: [] }, 2));
  sync.edit((b) => (b.items[0].text = "Edited"));
  sync.release();
  assert.equal(sync.conflicts[0].key, "a");
});
test("undo preserves unrelated remote work; redo re-applies local change", () => {
  const sync = setup();
  sync.edit((b) => (b.items[0].x = 240));
  const remote = clone(sync.draft);
  remote.items.push(event("b"));
  sync.receive(state(remote, 2));
  sync.undo();
  assert.equal(sync.draft.items[0].x, 40);
  assert.equal(sync.draft.items.length, 2);
  sync.undo(true);
  assert.equal(sync.draft.items[0].x, 240);
  assert.equal(sync.draft.items.length, 2);
});
test("draft recovery merges with the current server state", () => {
  const sync = setup();
  const journal = { base: clone(sync.base), draft: clone(sync.draft) };
  journal.draft.items[0].text = "Recovered";
  const remote = clone(sync.base);
  remote.items.push(event("b"));
  sync.receive(state(remote, 2));
  sync.recover(journal);
  assert.equal(sync.draft.items[0].text, "Recovered");
  assert.equal(sync.draft.items.length, 2);
});
test("out-of-order packets do not roll the board backwards", () => {
  const sync = setup();
  sync.receive(
    state({ ...starter(), title: "Latest", items: [event("a")] }, 3),
  );
  sync.receive(state(starter(), 2));
  assert.equal(sync.draft.title, "Latest");
});
test("JSON property order does not make an acknowledged board dirty", async () => {
  let writes = 0;
  const sync = setup(async (_url, body) => {
    writes++;
    return { ok: true, status: 200, body: state(body.board, 2) };
  });
  sync.edit((b) => (b.title = "Acknowledged"));
  await sync.save();
  assert.equal(sync.dirty, false);
  assert.equal(sync.status, "Saved");
  sync.receive(
    state(
      {
        notes: sync.base.notes,
        items: sync.base.items,
        phase: sync.base.phase,
        purpose: sync.base.purpose,
        title: sync.base.title,
        workshopId: sync.base.workshopId,
      },
      2,
    ),
  );
  assert.equal(sync.dirty, false);
  await sync.save();
  assert.equal(writes, 1);
});
test("SSE acknowledgement recovers an ambiguous lost HTTP response", async () => {
  let sync;
  sync = setup(async (_url, body) => {
    sync.receive(state(body.board, 2));
    throw new Error("Connection lost");
  });
  sync.edit((b) => (b.title = "Server accepted"));
  await sync.save();
  assert.equal(sync.dirty, false);
  assert.equal(sync.error, "");
  assert.equal(sync.status, "Saved");
});
test("a new workshop does not silently absorb a pending sticky from the previous workshop", () => {
  const sync = setup();
  sync.edit((b) => b.items.push(event("local-new")));
  sync.receive(
    state(
      { ...starter(), workshopId: "new-workshop", title: "Different domain" },
      2,
    ),
  );
  assert.equal(sync.conflicts[0].key, "board.workshop");
  sync.resolve("board.workshop", "remote");
  assert.equal(sync.draft.items.length, 0);
  assert.equal(sync.draft.title, "Different domain");
  assert.equal(sync.dirty, false);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { layout, dimensions } = require("../public/layout");
const legacy = require("./fixtures/legacy-workshop.json");
test("legacy misplaced commands stay inside expanded command lane without changing source", () => {
  const before = JSON.stringify(legacy.items),
    view = layout(legacy.items, true);
  const commands = view.lanes.find((l) => l.id === "commands");
  for (const item of legacy.items.filter((i) => i.role === "command")) {
    const shown = view.positions.get(item.id);
    assert.ok(shown.y >= commands.y + 36);
    assert.ok(shown.y + dimensions(shown).h <= commands.y + commands.h - 24);
    assert.equal(shown.x, item.x);
  }
  assert.equal(JSON.stringify(legacy.items), before);
});
test("additional overlapping cards expand a lane and push following lanes down", () => {
  const first = { id: "cmd-a", role: "command", text: "Submit", x: 60, y: 200 };
  const before = layout([first], true),
    after = layout([first, { ...first, id: "cmd-b", height: 240 }], true);
  const a = after.positions.get("cmd-a"),
    b = after.positions.get("cmd-b");
  assert.ok(b.y >= a.y + dimensions(a).h + 20);
  assert.ok(
    after.lanes.find((l) => l.id === "events").y >
      before.lanes.find((l) => l.id === "events").y,
  );
  for (let i = 1; i < after.lanes.length; i++)
    assert.equal(after.lanes[i].y, after.lanes[i - 1].y + after.lanes[i - 1].h);
});
test("side-by-side cards share a row and free layout retains exact coordinates", () => {
  const items = [
    { id: "a", role: "event", text: "Placed", x: 0, y: 330 },
    { id: "b", role: "event", text: "Confirmed", x: 200, y: 330 },
  ];
  const view = layout(items, true);
  assert.equal(view.positions.get("a").y, view.positions.get("b").y);
  assert.deepEqual([...layout(items, false).positions.values()], items);
});
test("scenario frames preserve internal geometry and move independently of global lanes", () => {
  const items = [
    { id: "f", role: "frame", text: "Alternative", x: 40, y: 60 },
    { id: "e", role: "event", text: "Rejected", frameId: "f", x: 80, y: 160 },
  ];
  const view = layout(items, true);
  assert.equal(view.positions.get("e").y - view.positions.get("f").y, 100);
  const moved = layout(
    items.map((i) => ({ ...i, y: i.y + 40 })),
    true,
  );
  assert.equal(moved.positions.get("f").y - view.positions.get("f").y, 40);
});

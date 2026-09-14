const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  starter,
  validate,
  merge,
  allowedRoles,
  PURPOSES,
} = require("../public/model");
const event = (id, text = "Order placed") => ({
  id,
  role: "event",
  text,
  x: 40,
  y: 330,
});
test("legacy workshop migrates without changing participant items", () => {
  const original = JSON.parse(
    fs.readFileSync(
      require("node:path").join(__dirname, "fixtures/legacy-workshop.json"),
    ),
  );
  const board = validate(original);
  assert.deepEqual(board.items, original.items);
  assert.equal(board.purpose, "process-modelling");
});
test("reject malformed schema, duplicate ids, unknown roles, invalid coordinates and broken membership", () => {
  for (const value of [
    null,
    [],
    { ...starter(), items: "wrong" },
    { ...starter(), items: [event("a"), event("a")] },
    { ...starter(), items: [{ ...event("a"), role: "toString" }] },
    { ...starter(), items: [{ ...event("a"), x: Infinity }] },
    { ...starter(), items: [{ ...event("a"), frameId: "missing" }] },
    { ...starter(), phase: "aggregates" },
  ])
    assert.throws(() => validate(value));
});
test("every workshop step permits hotspots; Big Picture does not require aggregates", () => {
  for (const [purpose, config] of Object.entries(PURPOSES))
    for (const phase of config.phases)
      assert.ok(
        allowedRoles({ ...starter(), purpose, phase }).includes("hotspot"),
      );
  assert.ok(!PURPOSES["big-picture"].phases.includes("aggregates"));
});
test("merge independent additions and edits to different fields on the same sticky", () => {
  const base = { ...starter(), items: [event("a")] };
  const local = structuredClone(base);
  local.items[0].text = "Order confirmed";
  local.items.push(event("b"));
  const remote = structuredClone(base);
  remote.items[0].x = 800;
  remote.items.push(event("c"));
  const result = merge(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(
    result.board.items.find((i) => i.id === "a").text,
    "Order confirmed",
  );
  assert.equal(result.board.items.find((i) => i.id === "a").x, 800);
  assert.deepEqual(result.board.items.map((i) => i.id).sort(), ["a", "b", "c"]);
});
test("competing text and deletion are explicit, with per-field resolution", () => {
  const base = { ...starter(), items: [event("a")] },
    local = structuredClone(base),
    remote = structuredClone(base);
  local.items[0].text = "Local";
  remote.items[0].text = "Remote";
  assert.equal(merge(base, local, remote).conflicts[0].key, "a.text");
  assert.equal(
    merge(base, local, remote, { "a.text": "remote" }).board.items[0].text,
    "Remote",
  );
  remote.items = [];
  assert.equal(merge(base, local, remote).conflicts[0].key, "a");
  assert.equal(
    merge(base, local, remote, { a: "remote" }).board.items.length,
    0,
  );
});
test("purpose and phase merge as one decision, never producing an impossible workflow", () => {
  const base = starter(),
    local = { ...base, purpose: "software-design", phase: "aggregates" },
    remote = { ...base, phase: "hotspots" };
  const result = merge(base, local, remote);
  assert.equal(result.conflicts[0].key, "board.workflow");
  assert.doesNotThrow(() =>
    validate(merge(base, local, remote, { "board.workflow": "remote" }).board),
  );
});
test("reserved keys cannot enter board state through JSON", () => {
  assert.throws(
    () =>
      validate(
        JSON.parse(
          '{"title":"X","phase":"timeline","items":[],"__proto__":{"polluted":true}}',
        ),
      ),
    /Reserved/,
  );
});

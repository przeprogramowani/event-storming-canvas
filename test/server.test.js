const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBoardServer } = require("../server");
const { BoardStore, atomicWrite } = require("../lib/store");
const { starter } = require("../public/model");
const execFile = require("node:util").promisify(
  require("node:child_process").execFile,
);
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storm-test-")),
    file = path.join(dir, "board.json");
  atomicWrite(file, starter());
  const app = createBoardServer({ file });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function request(route = "/api/board", body, headers = {}) {
    const res = await fetch(url + route, {
      ...(body !== undefined
        ? {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json", ...headers },
          }
        : { headers }),
    });
    return { status: res.status, body: await res.json() };
  }
  return { app, file, dir, url, request };
}
test("real HTTP: stale browser/agent writes are rejected and both can commit after re-read", async (t) => {
  const { request } = await fixture(t);
  const initial = (await request()).body;
  const first = structuredClone(initial.board);
  first.title = "Participant";
  assert.equal(
    (
      await request("/api/board", {
        board: first,
        expectedRevision: initial.revision,
      })
    ).status,
    200,
  );
  const stale = await request("/api/board", {
    board: initial.board,
    expectedRevision: initial.revision,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.board.title, "Participant");
  const next = stale.body.board;
  next.notes = "Agent contribution";
  assert.equal(
    (
      await request("/api/board", {
        board: next,
        expectedRevision: stale.body.revision,
      })
    ).status,
    200,
  );
  assert.equal((await request()).body.board.title, "Participant");
});
test("real HTTP rejects malformed schema and cross-origin, content-type, host, size violations", async (t) => {
  const { request, url } = await fixture(t);
  const original = (await request()).body;
  assert.equal(
    (
      await request("/api/board", {
        board: { ...starter(), items: "bad" },
        expectedRevision: original.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (await request("/api/board", {}, { Origin: "https://example.invalid" }))
      .status,
    403,
  );
  assert.equal(
    (await request("/api/board", {}, { "Content-Type": "text/plain" })).status,
    415,
  );
  // Node fetch normalizes Host; use HTTP directly to exercise the server boundary.
  const hostStatus = await new Promise((resolve, reject) => {
    require("node:http")
      .get(url + "/api/board", { headers: { Host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", reject);
  });
  assert.equal(hostStatus, 403);
  const large = await fetch(url + "/api/board", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: " ".repeat(2 * 1024 * 1024 + 1),
  });
  assert.equal(large.status, 413);
  assert.equal((await request()).body.revision, original.revision);
});
test("disk replacement is reconciled; malformed disk preserves last valid state and blocks writes", async (t) => {
  const { app, request, file } = await fixture(t);
  const board = { ...starter(), title: "External file replacement" };
  atomicWrite(file, board);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(app.store.board.title, board.title);
  fs.writeFileSync(file, "{ invalid");
  const state = (await request()).body;
  assert.equal(state.board.title, board.title);
  assert.match(state.warning, /invalid/);
  assert.equal(
    (await request("/api/board", { board, expectedRevision: state.revision }))
      .status,
    422,
  );
  atomicWrite(file, board);
  assert.equal((await request()).body.warning, null);
});
test("snapshots restore with CAS, archive current work and cannot escape history directory", async (t) => {
  const { request } = await fixture(t);
  const original = (await request()).body;
  await request("/api/board", {
    board: { ...starter(), title: "New workshop" },
    expectedRevision: original.revision,
    archive: true,
  });
  const history = (await request("/api/history")).body;
  const archive = history.find((e) => e.archive);
  assert.ok(archive);
  const current = (await request()).body;
  assert.equal(
    (
      await request("/api/restore", {
        name: archive.name,
        expectedRevision: original.revision,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request("/api/restore", {
        name: archive.name,
        expectedRevision: current.revision,
      })
    ).body.board.title,
    original.board.title,
  );
  assert.equal(
    (await request("/api/history?name=../../board.json")).status,
    404,
  );
});
test("restart recovery from malformed live file", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storm-store-")),
    file = path.join(dir, "board.json");
  atomicWrite(file, starter());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let store = new BoardStore(file);
  store.commit({ ...starter(), title: "Latest saved work" }, store.revision);
  store.close();
  fs.writeFileSync(file, "{");
  store = new BoardStore(file);
  assert.equal(store.board.title, "Latest saved work");
  assert.ok(store.warning);
  store.close();
});
test("SSE sends initial state, commits and a fresh state after reconnect", async (t) => {
  const { request, url } = await fixture(t);
  const controller = new AbortController();
  const response = await fetch(url + "/api/stream", {
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: board/);
  const initial = (await request()).body;
  await request("/api/board", {
    board: { ...starter(), title: "Stream update" },
    expectedRevision: initial.revision,
  });
  const update = new TextDecoder().decode((await reader.read()).value);
  assert.match(update, /Stream update/);
  controller.abort();
  const secondController = new AbortController();
  const second = await fetch(url + "/api/stream", {
    signal: secondController.signal,
  });
  const fresh = new TextDecoder().decode(
    (await second.body.getReader().read()).value,
  );
  assert.match(fresh, /Stream update/);
  secondController.abort();
});
test("agent CLI reads and commits through HTTP; stale draft is retained on conflict", async (t) => {
  const { app, request, dir } = await fixture(t);
  const draft = path.join(dir, "agent-draft.json");
  const cli = (...args) =>
    execFile(
      process.execPath,
      [path.join(__dirname, "../scripts/board.js"), ...args],
      { env: { ...process.env, PORT: String(app.server.address().port) } },
    );
  await cli("get", draft);
  const envelope = JSON.parse(fs.readFileSync(draft));
  envelope.board.notes = "Agent notes";
  fs.writeFileSync(draft, JSON.stringify(envelope));
  await cli("put", draft);
  assert.equal(app.store.board.notes, "Agent notes");
  const current = (await request()).body;
  await request("/api/board", {
    board: { ...current.board, title: "Human title" },
    expectedRevision: current.revision,
  });
  const retained = fs.readFileSync(draft, "utf8");
  await assert.rejects(cli("put", draft), /409/);
  assert.equal(fs.readFileSync(draft, "utf8"), retained);
  assert.equal(app.store.board.title, "Human title");
});

test("large SSE snapshots remain connected across consecutive writes", async (t) => {
  const { request, url } = await fixture(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(url + "/api/stream", {
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  let buffered = "";
  const nextBoard = async () => {
    while (!buffered.includes("\n\n")) {
      const { done, value } = await reader.read();
      assert.equal(
        done,
        false,
        "SSE closed while sending a healthy large board",
      );
      buffered += new TextDecoder().decode(value);
    }
    const end = buffered.indexOf("\n\n"),
      frame = buffered.slice(0, end);
    buffered = buffered.slice(end + 2);
    return JSON.parse(frame.split("\ndata: ")[1]);
  };
  const initial = await nextBoard();
  const board = {
    ...initial.board,
    items: Array.from({ length: 1000 }, (_, i) => ({
      id: `evt-${i}`,
      role: "event",
      text: "A business occurrence was recorded with enough detail to exceed the HTTP stream high-water mark",
      x: i * 80,
      y: 330,
    })),
  };
  await request("/api/board", { board, expectedRevision: initial.revision });
  const first = await nextBoard();
  assert.equal(first.board.items.length, 1000);
  first.board.title = "Still connected";
  await request("/api/board", {
    board: first.board,
    expectedRevision: first.revision,
  });
  assert.equal((await nextBoard()).board.title, "Still connected");
  controller.abort();
});

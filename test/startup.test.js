const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { start } = require("../server");
const { atomicWrite } = require("../lib/store");
const { starter } = require("../public/model");
function boardFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storm-start-"));
  const file = path.join(dir, "board.json");
  atomicWrite(file, starter());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return file;
}
test("stale lock files have no effect; repeated start reuses URL without touching storage", async (t) => {
  const file = boardFile(t),
    history = path.join(path.dirname(file), ".board-history");
  fs.mkdirSync(history);
  fs.writeFileSync(path.join(history, "server.lock"), "stale");
  fs.writeFileSync(path.join(history, "server.lock.recovery"), "stale");
  const app = await start({ file, port: 0, log() {} });
  t.after(() => app.close());
  const before = fs.statSync(path.join(history, "last-good.json")).mtimeMs,
    content = fs.readFileSync(file, "utf8");
  const messages = [];
  const duplicate = await start({
    file,
    port: app.server.address().port,
    log: (message) => messages.push(message),
  });
  assert.equal(duplicate, null);
  assert.match(messages[0], /already running: http/);
  assert.equal(
    fs.statSync(path.join(history, "last-good.json")).mtimeMs,
    before,
  );
  assert.equal(fs.readFileSync(file, "utf8"), content);
});
test("occupied port gives actionable message and never initializes board storage", async (t) => {
  const file = boardFile(t),
    foreign = http.createServer((_req, res) => res.end("another app"));
  await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => foreign.close(resolve)));
  await assert.rejects(
    start({ file, port: foreign.address().port, log() {} }),
    /occupied by another application/,
  );
  assert.equal(
    fs.existsSync(path.join(path.dirname(file), ".board-history")),
    false,
  );
});
test("a different board on the port is not reported as this workshop", async (t) => {
  const first = boardFile(t),
    second = boardFile(t);
  const app = await start({ file: first, port: 0, log() {} });
  t.after(() => app.close());
  await assert.rejects(
    start({ file: second, port: app.server.address().port, log() {} }),
    /different workshop/,
  );
  assert.equal(
    fs.existsSync(path.join(path.dirname(second), ".board-history")),
    false,
  );
});
test("invalid port fails clearly before touching storage", async (t) => {
  const file = boardFile(t);
  await assert.rejects(start({ file, port: NaN, log() {} }), /PORT must/);
  assert.equal(
    fs.existsSync(path.join(path.dirname(file), ".board-history")),
    false,
  );
});
test("forced process termination releases port and next start preserves board", async (t) => {
  const file = boardFile(t),
    before = fs.readFileSync(file, "utf8");
  const script = `require(${JSON.stringify(path.resolve(__dirname, "../server"))}).start({file:process.argv[1],port:0}).catch(e=>{console.error(e.message);process.exit(1)});`;
  const child = spawn(process.execPath, ["-e", script, file]);
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  });
  const [data] = await once(child.stdout, "data");
  const port = Number(String(data).match(/:(\d+)/)[1]);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  const app = await start({ file, port, log() {} });
  t.after(() => app.close());
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(
    fs.existsSync(path.join(path.dirname(file), ".board-history/server.lock")),
    false,
  );
});

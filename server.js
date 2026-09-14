// Local workshop server. All live writers use revision-checked HTTP commits.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const APP_ID = "event-storming-canvas";
function boardIdentity(file) {
  const canonical = path.join(
    fs.realpathSync(path.dirname(file)),
    path.basename(file),
  );
  return createHash("sha256").update(canonical).digest("hex");
}
const { BoardStore, MAX_BYTES } = require("./lib/store");

function createBoardServer({ file = path.join(__dirname, "board.json") } = {}) {
  const clients = new Set();
  let store;
  function broadcast() {
    if (!store) return;
    const frame = `event: board\ndata: ${JSON.stringify(store.state())}\n\n`;
    for (const res of clients) {
      // A single healthy large board may exceed the stream high-water mark.
      // Disconnect only clients accumulating several undelivered snapshots.
      if (res.writableLength > MAX_BYTES * 2) res.destroy();
      else res.write(frame);
    }
  }
  const identity = boardIdentity(file);
  const files = {
    "/": ["index.html", "text/html"],
    "/app.js": ["app.js", "text/javascript"],
    "/model.js": ["model.js", "text/javascript"],
    "/layout.js": ["layout.js", "text/javascript"],
    "/sync.js": ["sync.js", "text/javascript"],
    "/style.css": ["style.css", "text/css"],
  };
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const port = server.address().port;
      const allowedHosts = [
        `localhost:${port}`,
        `127.0.0.1:${port}`,
        `[::1]:${port}`,
      ];
      if (!allowedHosts.includes(req.headers.host))
        return json(res, 403, { error: "Host not allowed" });
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`
      )
        return json(res, 403, { error: "Origin not allowed" });
      if (req.headers["sec-fetch-site"] === "cross-site")
        return json(res, 403, { error: "Cross-site request blocked" });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/api/instance")
        return json(res, 200, { app: APP_ID, board: identity });
      if (req.method === "GET" && url.pathname === "/api/board") {
        store.refresh();
        return json(res, 200, store.state());
      }
      if (req.method === "GET" && url.pathname === "/api/history") {
        const name = url.searchParams.get("name");
        if (!name) return json(res, 200, store.history());
        if (!store.history().some((entry) => entry.name === name))
          return json(res, 404, { error: "Unknown snapshot" });
        return json(res, 200, store.read(path.join(store.historyDir, name)));
      }
      if (req.method === "GET" && url.pathname === "/api/stream") {
        store.refresh();
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`event: board\ndata: ${JSON.stringify(store.state())}\n\n`);
        clients.add(res);
        const ping = setInterval(() => {
          if (res.writableLength > MAX_BYTES * 2) res.destroy();
          else res.write(": ping\n\n");
        }, 25000);
        res.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }
      if (
        req.method === "POST" &&
        ["/api/board", "/api/restore"].includes(url.pathname)
      ) {
        if (
          req.headers["content-type"]?.split(";")[0].trim() !==
          "application/json"
        )
          return json(res, 415, { error: "Use application/json" });
        if (Number(req.headers["content-length"]) > MAX_BYTES)
          return json(res, 413, { error: "Request exceeds 2 MiB" });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BYTES) {
            json(res, 413, { error: "Request exceeds 2 MiB" });
            return;
          }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object")
          throw new Error("Expected a request object");
        const state =
          url.pathname === "/api/restore"
            ? store.restore(body.name, body.expectedRevision)
            : store.commit(body.board, body.expectedRevision, {
                archive: body.archive === true,
              });
        return json(res, 200, state);
      }
      if (req.method !== "GET")
        return json(res, 405, { error: "Method not allowed" });
      if (!Object.hasOwn(files, url.pathname))
        return json(res, 404, { error: "Not found" });
      const [name, mime] = files[url.pathname];
      const content = await fs.promises.readFile(
        path.join(__dirname, "public", name),
      );
      res.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
      res.end(content);
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status || (error.code ? 500 : 400), {
          error: error.code
            ? "Storage operation failed; changes were not acknowledged."
            : error.message,
          ...(error.status === 409 ? store.state() : {}),
        });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  // Reserve the port before touching workshop storage or starting a watcher.
  server.once("listening", () => {
    try {
      store = new BoardStore(file, broadcast);
    } catch (error) {
      server.close();
      server.emit("error", error);
    }
  });
  server.on("close", () => store?.close());
  return {
    server,
    get store() {
      return store;
    },
    async close() {
      for (const res of clients) res.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function probeInstance(url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(value);
    };
    const req = http.get(url + "/api/instance", (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
        if (data.length > 4096) finish(null);
      });
      res.on("end", () => {
        try {
          finish(res.statusCode === 200 ? JSON.parse(data) : null);
        } catch {
          finish(null);
        }
      });
      res.on("error", () => finish(null));
    });
    const timer = setTimeout(() => finish(null), 1500);
    req.on("error", () => finish(null));
  });
}
async function start({
  file = path.join(__dirname, "board.json"),
  port = Number(process.env.PORT || 4000),
  log = console.log,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be an integer between 0 and 65535.");
  const app = createBoardServer({ file });
  try {
    await new Promise((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    app.store?.close();
    if (error.code !== "EADDRINUSE") throw error;
    const url = `http://127.0.0.1:${port}`;
    const instance = await probeInstance(url);
    if (instance?.app === APP_ID && instance.board === boardIdentity(file)) {
      log(`Workshop board is already running: ${url}`);
      return null;
    }
    throw new Error(
      `Port ${port} is occupied by ${instance?.app === APP_ID ? "a different workshop" : "another application"}. Stop it or choose a different PORT. Use only one server per board.`,
    );
  }
  log(`Workshop board: http://127.0.0.1:${app.server.address().port}`);
  return app;
}
if (require.main === module) {
  start()
    .then((app) => {
      if (!app) return;
      for (const signal of ["SIGINT", "SIGTERM"])
        process.once(signal, () => app.close().then(() => process.exit(0)));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { createBoardServer, start };

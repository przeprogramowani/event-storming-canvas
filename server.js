// Zero-dependency whiteboard server.
//
// board.json is the single source of truth. Two writers touch it:
//   1. The browser (human) -> POST /api/board
//   2. An AI agent          -> edits board.json directly on disk
// fs.watch detects every change and pushes the fresh board to all
// connected browsers over Server-Sent Events, so the canvas is live.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 4000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const BOARD = path.join(ROOT, "board.json");

const clients = new Set(); // open SSE responses

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function readBoard() {
  try {
    return fs.readFileSync(BOARD, "utf8");
  } catch {
    return JSON.stringify({ title: "Workshop Board", items: [] });
  }
}

function broadcast() {
  const data = readBoard().replace(/\n/g, " ");
  for (const res of clients) {
    res.write(`event: board\ndata: ${data}\n\n`);
  }
}

// Watch the board file. Editors often replace the file (rename), which can
// detach a watcher, so we re-arm on every event with a small debounce.
let watchTimer = null;
function watchBoard() {
  try {
    fs.watch(BOARD, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(broadcast, 60);
    });
  } catch {
    // File may be mid-replace; retry shortly.
    setTimeout(watchBoard, 200);
  }
}
// Re-arm periodically in case the inode was swapped out by an external editor.
setInterval(watchBoard, 1000);
watchBoard();

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // --- Live update stream -------------------------------------------------
  if (pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: board\ndata: ${readBoard().replace(/\n/g, " ")}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  // --- Read board ---------------------------------------------------------
  if (pathname === "/api/board" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(readBoard());
    return;
  }

  // --- Write board (from browser) ----------------------------------------
  if (pathname === "/api/board" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const board = JSON.parse(body);
        board.updatedAt = new Date().toISOString();
        fs.writeFileSync(BOARD, JSON.stringify(board, null, 2) + "\n");
        res.writeHead(200, { "Content-Type": MIME[".json"] });
        res.end(JSON.stringify({ ok: true }));
        broadcast(); // immediate echo to all clients
      } catch (e) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad board JSON: " + e.message);
      }
    });
    return;
  }

  // --- Static files -------------------------------------------------------
  let file = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.join(PUBLIC, path.normalize(file));
  if (!resolved.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  sendFile(res, resolved);
});

server.listen(PORT, () => {
  console.log(`\n  🎨  Workshop whiteboard running at http://localhost:${PORT}`);
  console.log(`      Editing board.json (by hand or AI) updates the browser live.\n`);
});

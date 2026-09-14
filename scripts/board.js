#!/usr/bin/env node
// Read and commit a revision-bearing envelope; never refresh its revision blindly.
const fs = require("node:fs");
const { validate } = require("../public/model");
async function main() {
  const [command, file] = process.argv.slice(2);
  const base = `http://127.0.0.1:${process.env.PORT || 4000}`;
  if (!["get", "put", "history", "restore"].includes(command))
    throw new Error(
      "Usage: node scripts/board.js get [draft.json] | put draft.json | history | restore request.json",
    );
  let body;
  if (["put", "restore"].includes(command)) {
    if (!file) throw new Error("A request file is required");
    body = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      typeof body.expectedRevision !== "string" &&
      typeof body.revision !== "string"
    )
      throw new Error(
        "Keep the revision from the original get; do not obtain a new revision for a stale draft",
      );
    body.expectedRevision = body.expectedRevision || body.revision;
    if (command === "put") {
      body.board = validate(body.board);
      for (const item of body.board.items)
        if (item.source === "AI" && !item.status) item.status = "suggested";
    }
  }
  const route =
    command === "history"
      ? "/api/history"
      : command === "restore"
        ? "/api/restore"
        : "/api/board";
  const response = await fetch(base + route, {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `${response.status}: ${result.error}. Original draft remains unchanged.`,
    );
  const text = JSON.stringify(result, null, 2) + "\n";
  if (command === "get" && file)
    fs.writeFileSync(file, text, { flag: "wx", mode: 0o600 });
  else process.stdout.write(text);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

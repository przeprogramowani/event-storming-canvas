const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { validate, starter, clone, canonical } = require("../public/model");

const MAX_BYTES = 2 * 1024 * 1024;
const revisionOf = (board) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(board)))
    .digest("hex");
function atomicWrite(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

class BoardStore {
  constructor(file, onChange = () => {}) {
    this.file = file;
    this.historyDir = path.join(path.dirname(file), ".board-history");
    this.onChange = onChange;
    this.instance = randomUUID();
    this.sequence = 0;
    this.warning = null;
    this.board = null;
    this.diskValid = false;
    fs.mkdirSync(this.historyDir, { recursive: true, mode: 0o700 });
    try {
      this.refresh();
      if (!this.board) {
        for (const entry of this.history()) {
          try {
            this.board = this.read(path.join(this.historyDir, entry.name));
            break;
          } catch {
            /* try older snapshot */
          }
        }
        if (!this.board) this.board = starter();
      }
      this.revision = revisionOf(this.board);
      this.lastGoodFile = path.join(this.historyDir, "last-good.json");
      if (this.diskValid) atomicWrite(this.lastGoodFile, this.board);
      this.watchTimer = null;
      try {
        this.watcher = fs.watch(path.dirname(file), (_event, name) => {
          if (name && String(name) !== path.basename(file)) return;
          clearTimeout(this.watchTimer);
          this.watchTimer = setTimeout(() => this.refresh(), 80);
        });
        this.watcher.on("error", () => {
          this.watcher.close();
        });
      } catch {
        /* periodic reconciliation also covers unsupported watchers */
      }
      this.poll = setInterval(() => this.refresh(), 2000);
      this.poll.unref();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  read(file) {
    if (fs.statSync(file).size > MAX_BYTES)
      throw new Error("Board exceeds 2 MiB");
    return validate(JSON.parse(fs.readFileSync(file, "utf8")));
  }
  snapshot(board, archive = false) {
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}${archive ? "-archive" : ""}.json`;
    atomicWrite(path.join(this.historyDir, name), board);
    const routine = this.history().filter(
      (entry) => !entry.archive && entry.name !== "last-good.json",
    );
    for (const entry of routine.slice(50))
      fs.unlinkSync(path.join(this.historyDir, entry.name));
  }
  history() {
    return fs
      .readdirSync(this.historyDir)
      .filter((name) => /^[\w-]+\.json$/.test(name))
      .sort()
      .reverse()
      .map((name) => ({ name, archive: name.endsWith("-archive.json") }));
  }
  refresh() {
    const previousWarning = this.warning;
    try {
      const next = this.read(this.file);
      const revision = revisionOf(next);
      if (revision !== this.revision) {
        if (this.board) this.snapshot(this.board);
        if (this.lastGoodFile) atomicWrite(this.lastGoodFile, next);
        this.board = next;
        this.revision = revision;
        this.sequence++;
        this.diskValid = true;
        this.warning = null;
        this.onChange();
      } else {
        this.diskValid = true;
        this.warning = null;
      }
    } catch (error) {
      this.diskValid = false;
      this.warning = `Board file unavailable or invalid: ${error.message}. Showing the last valid board. Fix the file or explicitly restore a snapshot.`;
    }
    if (previousWarning !== this.warning) this.onChange();
  }
  state() {
    return {
      board: clone(this.board),
      revision: this.revision,
      sequence: this.sequence,
      instance: this.instance,
      warning: this.warning,
    };
  }
  commit(board, expectedRevision, { archive = false, restore = false } = {}) {
    this.refresh();
    if (!expectedRevision || expectedRevision !== this.revision) {
      const error = new Error(
        "Board changed. Read the latest state and resolve competing edits.",
      );
      error.status = 409;
      throw error;
    }
    if (!this.diskValid && !restore) {
      const error = new Error(this.warning);
      error.status = 422;
      throw error;
    }
    const next = validate(board);
    if (Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES)
      throw new Error("Board exceeds 2 MiB");
    this.snapshot(this.board, archive);
    next.updatedAt = new Date().toISOString();
    atomicWrite(this.file, next);
    this.board = next;
    this.revision = revisionOf(next);
    this.sequence++;
    this.diskValid = true;
    this.warning = null;
    try {
      atomicWrite(this.lastGoodFile, next);
    } catch {
      this.warning =
        "Board saved, but the recovery copy could not be refreshed.";
    }
    this.onChange();
    return this.state();
  }
  restore(name, revision) {
    if (!this.history().some((entry) => entry.name === name))
      throw new Error("Unknown snapshot");
    return this.commit(this.read(path.join(this.historyDir, name)), revision, {
      archive: true,
      restore: true,
    });
  }
  close() {
    clearInterval(this.poll);
    clearTimeout(this.watchTimer);
    this.watcher?.close();
  }
}
module.exports = { BoardStore, atomicWrite, MAX_BYTES };

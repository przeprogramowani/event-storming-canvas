(function (root, factory) {
  if (typeof module === "object") module.exports = factory(require("./model"));
  else root.BoardSync = factory(root.BoardModel);
})(globalThis, function ({ clone, merge, validate, equal }) {
  const same = (a, b) => {
    const clean = (board) => {
      const value = clone(board);
      delete value.updatedAt;
      return value;
    };
    return equal(clean(a), clean(b));
  };
  class Sync {
    constructor({ request, changed = () => {} }) {
      this.request = request;
      this.changed = changed;
      this.base = null;
      this.draft = null;
      this.remote = null;
      this.busy = false;
      this.held = false;
      this.queued = null;
      this.conflicts = [];
      this.undoStack = [];
      this.redoStack = [];
      this.error = "";
      this.status = "Loading…";
    }
    get dirty() {
      return this.base && !same(this.base, this.draft);
    }
    receive(state) {
      state = { ...state, board: validate(state.board) };
      if (typeof state.revision !== "string")
        throw new Error("Missing board revision");
      if (
        this.remote?.instance === state.instance &&
        state.sequence < this.remote.sequence
      )
        return;
      if (this.busy || this.held || this.conflicts.length) {
        if (
          !this.queued ||
          this.queued.instance !== state.instance ||
          state.sequence >= this.queued.sequence
        )
          this.queued = state;
        return;
      }
      if (!this.base) {
        this.base = clone(state.board);
        this.draft = clone(state.board);
      } else {
        const result = merge(this.base, this.draft, state.board);
        if (result.conflicts.length)
          this.resolution = {
            base: clone(this.base),
            local: clone(this.draft),
            remote: clone(state.board),
            choices: {},
          };
        this.conflicts = result.conflicts;
        this.draft = result.board;
        this.base = clone(state.board);
      }
      this.remote = state;
      if (!this.dirty && !this.conflicts.length) this.error = "";
      this.status = this.conflicts.length
        ? "Resolve competing edits"
        : this.dirty
          ? "Unsaved changes"
          : "Saved";
      this.changed();
    }
    hold() {
      this.held = true;
    }
    release() {
      this.held = false;
      this.drain();
      this.changed();
    }
    drain() {
      if (this.queued && !this.busy && !this.held && !this.conflicts.length) {
        const next = this.queued;
        this.queued = null;
        this.receive(next);
      }
    }
    edit(change, record = true) {
      if (!this.draft || this.conflicts.length) return;
      const before = clone(this.draft);
      const next = clone(this.draft);
      change(next);
      this.draft = validate(next);
      if (same(before, this.draft)) return;
      if (record) {
        this.undoStack.push({ before, after: clone(this.draft) });
        this.undoStack = this.undoStack.slice(-50);
        this.redoStack = [];
      }
      this.error = "";
      this.status = "Unsaved changes";
      this.changed();
    }
    resolve(key, choice) {
      this.resolution.choices[key] = choice;
      const { base, local, remote, choices } = this.resolution;
      const result = merge(base, local, remote, choices);
      this.draft = result.board;
      this.conflicts = result.conflicts;
      if (!this.conflicts.length) {
        this.resolution = null;
        this.status = this.dirty ? "Unsaved changes" : "Saved";
        this.drain();
      }
      this.changed();
    }
    undo(redo = false) {
      if (this.busy || this.held || this.conflicts.length) return;
      const from = redo ? this.redoStack : this.undoStack;
      const entry = from.pop();
      if (!entry) return;
      const base = redo ? entry.before : entry.after;
      const local = redo ? entry.after : entry.before;
      const remote = clone(this.draft);
      const result = merge(base, local, remote);
      if (result.conflicts.length)
        this.resolution = { base, local, remote, choices: {} };
      this.draft = result.board;
      this.conflicts = result.conflicts;
      (redo ? this.undoStack : this.redoStack).push(entry);
      this.error = "";
      this.status = this.conflicts.length
        ? "Resolve competing edits"
        : "Unsaved changes";
      this.changed();
    }
    recover(journal) {
      const base = validate(journal.base),
        local = validate(journal.draft),
        remote = clone(this.base);
      const result = merge(base, local, remote);
      if (result.conflicts.length)
        this.resolution = { base, local, remote, choices: {} };
      this.draft = result.board;
      this.conflicts = result.conflicts;
      this.status = "Recovered local draft";
      this.changed();
    }
    async save() {
      if (!this.dirty || this.busy || this.held || this.conflicts.length)
        return false;
      let sent;
      try {
        sent = validate(this.draft);
      } catch (error) {
        this.error = error.message;
        this.changed();
        return false;
      }
      this.busy = true;
      this.error = "";
      this.status = "Saving…";
      this.changed();
      let success = false;
      try {
        const response = await this.request("/api/board", {
          board: sent,
          expectedRevision: this.remote.revision,
        });
        if (response.status === 409) {
          this.busy = false;
          this.receive(response.body);
        } else {
          if (!response.ok)
            throw new Error(
              response.body.error || `Save failed (${response.status})`,
            );
          const accepted = validate(response.body.board);
          // Edits made during the request remain pending, on top of its acknowledged state.
          const result = merge(sent, this.draft, accepted);
          this.draft = result.board;
          this.base = clone(accepted);
          this.remote = response.body;
          this.status = this.dirty ? "Unsaved changes" : "Saved";
          success = true;
        }
      } catch (error) {
        this.error = `${error.message} Your changes are retained; retry when ready.`;
        this.status = "Save failed";
      } finally {
        this.busy = false;
        this.drain();
        this.changed();
      }
      return success;
    }
  }
  return { Sync, same };
});

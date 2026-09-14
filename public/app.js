/* global BoardModel, BoardSync, BoardLayout */
const { ROLES, PHASES, PURPOSES, starter, clone, allowedRoles } = BoardModel;
const $ = (id) => document.getElementById(id);
const viewport = $("board"),
  surface = $("surface"),
  nodes = new Map();
const selected = new Set();
let zoom = 1,
  timer,
  editingId = null,
  lifecycle = false;
let recovery;
try {
  recovery = JSON.parse(sessionStorage.getItem("board-draft"));
} catch {
  /* storage may be disabled */
}
$("draft-recovery").hidden = !recovery;
$("recover-draft").disabled = true;
async function request(url, body) {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        }
      : { signal: AbortSignal.timeout(15000) },
  );
  return {
    ok: response.ok,
    status: response.status,
    body: await response.json(),
  };
}
const sync = new BoardSync.Sync({ request, changed: changed });
function changed() {
  render();
  if (sync.base && !recovery) {
    try {
      if (sync.dirty || sync.conflicts.length)
        sessionStorage.setItem(
          "board-draft",
          JSON.stringify({
            base: sync.resolution?.base || sync.base,
            draft: sync.resolution?.local || sync.draft,
          }),
        );
      else sessionStorage.removeItem("board-draft");
    } catch {
      $("warning").textContent =
        "Local draft backup is unavailable in this browser. Export unsaved work before closing.";
      $("warning").hidden = false;
    }
  }
  clearTimeout(timer);
  if (
    sync.dirty &&
    !sync.busy &&
    !sync.held &&
    !sync.conflicts.length &&
    !sync.error &&
    !lifecycle
  )
    timer = setTimeout(() => sync.save(), 200);
}
function option(value, text) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = text;
  return el;
}
for (const [id, purpose] of Object.entries(PURPOSES)) {
  $("purpose").append(option(id, purpose.label));
  $("new-purpose").append(option(id, purpose.label));
}
for (const [role, def] of Object.entries(ROLES)) {
  const button = document.createElement("button");
  button.dataset.role = role;
  button.disabled = true;
  const dot = document.createElement("span");
  dot.className = "tool-dot";
  dot.style.background = def.bg || "transparent";
  button.append(dot, document.createTextNode(def.label));
  button.onclick = () => addItem(role);
  $("tools").append(button);
  const label = document.createElement("span");
  label.dataset.role = role;
  label.className = "legend-item";
  label.append(dot.cloneNode(true), document.createTextNode(def.tag));
  $("legend").append(label);
}
let layoutView = { positions: new Map(), lanes: [] };
function render() {
  const board = sync.draft;
  if (!board) return;
  $("board-title").textContent = board.title;
  $("welcome").hidden =
    board.items.length > 0 ||
    board.title !== "Event Storming" ||
    board.phase !== "chaotic-exploration";
  $("start-domain").disabled =
    !!sync.conflicts.length || lifecycle || !!recovery;
  $("start-form").querySelector("button").disabled = $("start-domain").disabled;
  $("saved").textContent = sync.error || sync.status;
  $("retry").hidden = !sync.error;
  $("retry").disabled = sync.busy || sync.held;
  $("warning").textContent = sync.remote?.warning || "";
  $("warning").hidden = !sync.remote?.warning;
  const blocked = !!sync.conflicts.length || lifecycle || !!recovery;
  $("recover-draft").disabled = !sync.base;
  $("purpose").value = board.purpose;
  $("purpose").disabled = blocked || sync.held;
  const mode = PURPOSES[board.purpose];
  $("mode-description").textContent = mode.description;
  const roles = new Set(mode.roles);
  for (const button of $("tools").children) {
    button.hidden = !roles.has(button.dataset.role);
    button.disabled = blocked || sync.held;
  }
  for (const label of $("legend").children)
    label.hidden =
      !roles.has(label.dataset.role) &&
      !board.items.some((i) => i.role === label.dataset.role);
  $("lanes").hidden = !mode.structured;
  for (const id of ["notes-btn", "new-btn", "history-btn"])
    $(id).disabled =
      blocked || sync.busy || sync.held || (id !== "notes-btn" && sync.dirty);
  $("export-btn").disabled = false;
  layoutView = BoardLayout.layout(board.items, mode.structured, mode.roles);
  $("lanes").replaceChildren(
    ...layoutView.lanes.map(({ id, label, y, h }) => {
      const lane = document.createElement("div");
      lane.className = "lane";
      lane.dataset.lane = id;
      lane.style.top = y + "px";
      lane.style.height = h + "px";
      const heading = document.createElement("span");
      heading.textContent = label;
      lane.append(heading);
      return lane;
    }),
  );
  const ids = new Set(board.items.map((i) => i.id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  for (const [id, node] of nodes)
    if (!ids.has(id)) {
      node.remove();
      nodes.delete(id);
    }
  for (const item of board.items) {
    let node = nodes.get(item.id);
    if (!node) {
      node = document.createElement("div");
      node.dataset.id = item.id;
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      nodes.set(item.id, node);
      surface.append(node);
      attachHandlers(node);
    }
    const shown = layoutView.positions.get(item.id);
    const signature = JSON.stringify(shown);
    if (node.dataset.signature !== signature) {
      paint(node, shown);
      node.dataset.signature = signature;
    }
    node.classList.toggle("selected", selected.has(item.id));
    node.setAttribute("aria-pressed", String(selected.has(item.id)));
    node.setAttribute("aria-disabled", String(blocked));
  }
  $("edit-btn").disabled = selected.size !== 1 || blocked || sync.held;
  $("delete-btn").disabled = !selected.size || blocked || sync.held;
  $("undo-btn").disabled =
    !sync.undoStack.length || blocked || sync.busy || sync.held;
  $("redo-btn").disabled =
    !sync.redoStack.length || blocked || sync.busy || sync.held;
  sizeSurface();
  renderConflicts();
}
function dimensions(item) {
  return {
    w: item.width || ROLES[item.role].w,
    h: item.height || ROLES[item.role].h,
  };
}
function sizeSurface() {
  const items = [...layoutView.positions.values()];
  const width = Math.max(
    1600,
    ...items.map((i) => i.x + dimensions(i).w + 160),
  );
  const height = Math.max(
    950,
    ...layoutView.lanes.map((lane) => lane.y + lane.h + 40),
    ...items.map((i) => i.y + dimensions(i).h + 160),
  );
  surface.style.width = width + "px";
  surface.style.height = height + "px";
  surface.style.transform = `scale(${zoom})`;
  $("extent").style.width = width * zoom + "px";
  $("extent").style.height = height * zoom + "px";
  $("zoom-level").textContent = Math.round(zoom * 100) + "%";
}
function paint(node, item) {
  const def = ROLES[item.role],
    { w, h } = dimensions(item);
  node.className =
    "item " +
    (item.role === "frame"
      ? "frame"
      : item.role === "label"
        ? "annotation"
        : "sticky");
  node.style.left = item.x + "px";
  node.style.top = item.y + "px";
  node.style.width = w + "px";
  node.style.height = h + "px";
  node.style.background =
    item.role === "frame" ? "" : item.color || def.bg || "";
  node.style.fontSize =
    item.role === "label" ? (item.fontSize || 22) + "px" : "";
  node.title = `${item.text}\n${item.status || "Unreviewed"}${item.source ? " · " + item.source : ""}${item.invariant ? "\nRule: " + item.invariant : ""}${item.termination ? "\nEnds when: " + item.termination : ""}`;
  node.setAttribute(
    "aria-label",
    `${def.label}: ${node.title}. Enter to edit; arrow keys to move.`,
  );
  const tag = document.createElement("span");
  tag.className = "item-tag";
  tag.textContent =
    (item.role === "frame" ? item.frameKind || "scenario" : def.tag) +
    (item.status === "suggested"
      ? " · SUGGESTED"
      : item.status === "confirmed"
        ? " · CONFIRMED"
        : "");
  const text = document.createElement("span");
  text.className = "item-text";
  text.textContent = item.text;
  const detail = document.createElement("span");
  detail.className = "item-detail";
  detail.textContent = [
    item.priority,
    item.owner,
    item.termination && "Ends: " + item.termination,
  ]
    .filter(Boolean)
    .join(" · ");
  const content = document.createElement("div");
  content.className = "item-content";
  content.append(tag, text, detail);
  node.replaceChildren(content);
}
function choose(id, additive = false) {
  if (!additive) selected.clear();
  if (additive && selected.has(id)) selected.delete(id);
  else selected.add(id);
  render();
}
function moveIds() {
  const ids = new Set(selected);
  for (const item of sync.draft.items)
    if (item.frameId && selected.has(item.frameId)) ids.add(item.id);
  return ids;
}
function attachHandlers(node) {
  node.addEventListener("focus", () => {
    if (!selected.has(node.dataset.id)) choose(node.dataset.id);
  });
  node.addEventListener("dblclick", () => openEditor(node.dataset.id));
  node.addEventListener("keydown", (e) => {
    if (sync.conflicts.length || lifecycle || sync.held || recovery) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openEditor(node.dataset.id);
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      if (!selected.has(node.dataset.id)) choose(node.dataset.id);
      const step = e.shiftKey ? 40 : 10;
      moveSelection(
        e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
        e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
      );
    }
  });
  node.addEventListener("pointerdown", (e) => {
    if (
      e.button !== 0 ||
      sync.conflicts.length ||
      lifecycle ||
      sync.held ||
      recovery
    )
      return;
    if (e.shiftKey) {
      choose(node.dataset.id, true);
      e.preventDefault();
      return;
    }
    if (!selected.has(node.dataset.id)) choose(node.dataset.id);
    node.focus({ preventScroll: true });
    e.preventDefault();
    sync.hold();
    const startX = e.clientX,
      startY = e.clientY;
    const ids = moveIds();
    const originals = sync.draft.items
      .filter((i) => ids.has(i.id))
      .map((i) => ({
        id: i.id,
        x: i.x,
        y: i.y,
        shownY: layoutView.positions.get(i.id).y,
      }));
    const minX = Math.min(...originals.map((i) => i.x)),
      minY = Math.min(...originals.map((i) => i.y));
    const maxX = Math.max(...originals.map((i) => i.x)),
      maxY = Math.max(...originals.map((i) => i.y));
    let dx = 0,
      dy = 0,
      ended = false;
    node.setPointerCapture(e.pointerId);
    node.classList.add("dragging");
    const move = (ev) => {
      dx = Math.max(
        -minX,
        Math.min(100000 - maxX, (ev.clientX - startX) / zoom),
      );
      dy = Math.max(
        -minY,
        Math.min(100000 - maxY, (ev.clientY - startY) / zoom),
      );
      for (const item of originals) {
        const el = nodes.get(item.id);
        el.style.left = item.x + dx + "px";
        el.style.top = item.shownY + dy + "px";
      }
    };
    const finish = (cancelled) => {
      if (ended) return;
      ended = true;
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
      node.removeEventListener("lostpointercapture", cancel);
      document.removeEventListener("keydown", escape);
      if (node.hasPointerCapture(e.pointerId))
        node.releasePointerCapture(e.pointerId);
      for (const item of originals) nodes.get(item.id).dataset.signature = "";
      node.classList.remove("dragging");
      if (!cancelled && (dx || dy))
        sync.edit((board) => {
          for (const item of board.items)
            if (ids.has(item.id)) {
              item.x += dx;
              item.y += dy;
            }
        });
      sync.release();
      render();
    };
    const up = () => finish(false),
      cancel = () => finish(true),
      escape = (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          finish(true);
        }
      };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    node.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", escape);
  });
}
function moveSelection(dx, dy) {
  const ids = moveIds(),
    members = sync.draft.items.filter((i) => ids.has(i.id));
  dx = Math.max(
    -Math.min(...members.map((i) => i.x)),
    Math.min(100000 - Math.max(...members.map((i) => i.x)), dx),
  );
  dy = Math.max(
    -Math.min(...members.map((i) => i.y)),
    Math.min(100000 - Math.max(...members.map((i) => i.y)), dy),
  );
  sync.edit((board) => {
    for (const item of board.items)
      if (ids.has(item.id)) {
        item.x += dx;
        item.y += dy;
      }
  });
}
function addItem(role) {
  if (
    !sync.draft ||
    sync.conflicts.length ||
    sync.held ||
    lifecycle ||
    recovery
  )
    return;
  const def = ROLES[role],
    id = `${role}-${crypto.randomUUID()}`;
  const free = !PURPOSES[sync.draft.purpose].structured;
  let x = Math.round(viewport.scrollLeft / zoom + 40),
    y = Math.round(
      free || role === "frame" || role === "label"
        ? viewport.scrollTop / zoom + 60
        : def.y,
    );
  const origin = x,
    available = Math.max(600, viewport.clientWidth / zoom - 80);
  while (
    sync.draft.items.some(
      (i) =>
        i.role !== "frame" &&
        x < i.x + dimensions(i).w + 20 &&
        x + def.w + 20 > i.x &&
        y < i.y + dimensions(i).h + 20 &&
        y + def.h + 20 > i.y,
    )
  ) {
    x += def.w + 24;
    if (x - origin > available) {
      x = origin;
      y += def.h + 32;
    }
  }
  const texts = {
    event: "Something happened",
    command: "Do something",
    actor: "Business role",
    hotspot: "What is unclear?",
    policy: "Whenever … then …",
    readmodel: "Information to decide",
    external: "External system",
    aggregate: "Candidate aggregate",
    label: "Annotation",
    frame: "Scenario",
  };
  sync.edit((board) =>
    board.items.push({
      id,
      role,
      text: texts[role],
      x,
      y,
      source: "Participant",
      ...(role === "frame" ? { frameKind: "scenario" } : {}),
    }),
  );
  choose(id);
  nodes.get(id).scrollIntoView({ block: "nearest", inline: "nearest" });
  openEditor(id);
}
function deleteSelected() {
  if (
    !selected.size ||
    sync.held ||
    lifecycle ||
    sync.conflicts.length ||
    recovery
  )
    return;
  sync.edit((board) => {
    board.items = board.items.filter((i) => !selected.has(i.id));
    for (const item of board.items)
      if (selected.has(item.frameId)) delete item.frameId;
  });
  selected.clear();
  render();
}
function openEditor(id) {
  if (sync.held || sync.conflicts.length || lifecycle || recovery) return;
  const item = sync.draft.items.find((i) => i.id === id);
  if (!item) return;
  editingId = id;
  sync.hold();
  $("edit-error").textContent = "";
  $("editor-title").textContent =
    "Edit " + ROLES[item.role].label.toLowerCase();
  $("item-frame").replaceChildren(
    option("", "No frame"),
    ...sync.draft.items
      .filter((i) => i.role === "frame" && i.id !== id)
      .map((i) => option(i.id, i.text)),
  );
  $("item-frame").disabled = item.role === "frame";
  for (const key of [
    "text",
    "status",
    "source",
    "priority",
    "owner",
    "nextStep",
    "invariant",
    "termination",
    "frameKind",
  ])
    $("item-" + key).value =
      item[key] || (key === "frameKind" ? "scenario" : "");
  $("item-frame").value = item.frameId || "";
  $("item-width").value = dimensions(item).w;
  $("item-height").value = dimensions(item).h;
  for (const id of [
    "frame-kind-label",
    "frame-width-label",
    "frame-height-label",
  ])
    $(id).hidden = item.role !== "frame";
  for (const id of ["item-frameKind", "item-width", "item-height"])
    $(id).disabled = item.role !== "frame";
  $("editor").showModal();
  $("item-text").focus();
  $("item-text").select();
}
function closeEditor() {
  $("editor").close();
  editingId = null;
  sync.release();
}
$("cancel-edit").onclick = closeEditor;
$("editor").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeEditor();
});
$("edit-form").onsubmit = (e) => {
  e.preventDefault();
  try {
    sync.edit((board) => {
      const item = board.items.find((i) => i.id === editingId);
      for (const key of [
        "text",
        "status",
        "source",
        "priority",
        "owner",
        "nextStep",
        "invariant",
        "termination",
      ]) {
        const value = $("item-" + key).value.trim();
        if (value || key === "text") item[key] = value;
        else delete item[key];
      }
      if (item.role === "frame") {
        item.frameKind = $("item-frameKind").value;
        item.width = Number($("item-width").value);
        item.height = Number($("item-height").value);
      } else if ($("item-frame").value) item.frameId = $("item-frame").value;
      else delete item.frameId;
    });
    closeEditor();
  } catch (error) {
    $("edit-error").textContent = error.message;
  }
};
$("edit-btn").onclick = () => openEditor([...selected][0]);
$("delete-btn").onclick = deleteSelected;
$("undo-btn").onclick = () => sync.undo();
$("redo-btn").onclick = () => sync.undo(true);
$("retry").onclick = () => {
  sync.error = "";
  sync.save();
};
$("purpose").onchange = () =>
  sync.edit((board) => {
    board.purpose = $("purpose").value;
    if (!PURPOSES[board.purpose].phases.includes(board.phase))
      board.phase = PURPOSES[board.purpose].phases[0];
  });
$("start-form").onsubmit = (event) => {
  event.preventDefault();
  const domain = $("start-domain").value.trim();
  if (!domain || !sync.draft || sync.conflicts.length || recovery || lifecycle)
    return;
  sync.edit((board) => {
    board.title = "Event Storming — " + domain;
  });
};
document.querySelector(".workshop-menu").addEventListener("click", (event) => {
  if (event.target.closest("button"))
    document.querySelector(".workshop-menu").open = false;
});
viewport.addEventListener("pointerdown", (e) => {
  if ([viewport, surface, $("extent"), $("lanes")].includes(e.target)) {
    selected.clear();
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if (
    document.querySelector("dialog[open]") ||
    /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
  )
    return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    sync.undo(e.shiftKey);
  }
  if (["Delete", "Backspace"].includes(e.key) && selected.size) {
    e.preventDefault();
    deleteSelected();
  }
});
function setZoom(next) {
  const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / zoom,
    centerY = (viewport.scrollTop + viewport.clientHeight / 2) / zoom;
  zoom = Math.max(0.05, Math.min(2, next));
  sizeSurface();
  viewport.scrollLeft = centerX * zoom - viewport.clientWidth / 2;
  viewport.scrollTop = centerY * zoom - viewport.clientHeight / 2;
}
$("zoom-in").onclick = () => setZoom(zoom * 1.25);
$("zoom-out").onclick = () => setZoom(zoom / 1.25);
$("fit").onclick = () => {
  const items = [...layoutView.positions.values()];
  if (!items.length) return setZoom(1);
  const left = Math.min(...items.map((i) => i.x)),
    top = Math.min(...items.map((i) => i.y));
  const right = Math.max(...items.map((i) => i.x + dimensions(i).w)),
    bottom = Math.max(...items.map((i) => i.y + dimensions(i).h));
  setZoom(
    Math.min(
      viewport.clientWidth / (right - left + 100),
      viewport.clientHeight / (bottom - top + 100),
      1,
    ),
  );
  viewport.scrollLeft = Math.max(0, (left - 50) * zoom);
  viewport.scrollTop = Math.max(0, (top - 50) * zoom);
};
function download(board, name = "workshop.json") {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(board, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export-btn").onclick = () => download(sync.draft);
function renderConflicts() {
  const panel = $("conflicts");
  panel.hidden = !sync.conflicts.length;
  const signature = JSON.stringify(sync.conflicts);
  if (panel.dataset.signature === signature) return;
  panel.dataset.signature = signature;
  panel.replaceChildren();
  if (!sync.conflicts.length) return;
  const title = document.createElement("p");
  title.textContent = sync.conflicts.some((c) => c.key === "board.workshop")
    ? "Another participant replaced the workshop. Export your draft before deciding: keeping your version will replace the whole shared workshop."
    : "Competing edits need your decision. Other changes are retained; saving is paused.";
  panel.append(title);
  for (const conflict of sync.conflicts) {
    const row = document.createElement("div");
    row.className = "conflict";
    const label = document.createElement("strong");
    label.textContent = conflict.key;
    row.append(label);
    for (const choice of ["local", "remote"]) {
      const box = document.createElement("div"),
        text = document.createElement("pre"),
        button = document.createElement("button");
      text.textContent =
        conflict[choice] === undefined
          ? "(deleted)"
          : typeof conflict[choice] === "string"
            ? conflict[choice]
            : JSON.stringify(conflict[choice], null, 2);
      button.textContent =
        choice === "local" ? "Keep my change" : "Use incoming change";
      button.onclick = () => sync.resolve(conflict.key, choice);
      box.append(text, button);
      row.append(box);
    }
    panel.append(row);
  }
}
$("notes-btn").onclick = () => {
  sync.hold();
  $("workshop-title").value = sync.draft.title;
  $("notes-text").value = sync.draft.notes;
  $("notes-dialog").showModal();
};
function closeNotes() {
  $("notes-dialog").close();
  sync.release();
}
$("cancel-notes").onclick = closeNotes;
$("notes-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeNotes();
});
$("notes-form").onsubmit = (e) => {
  e.preventDefault();
  sync.edit((board) => {
    board.title = $("workshop-title").value;
    board.notes = $("notes-text").value;
  });
  closeNotes();
};
$("recover-draft").onclick = () => {
  try {
    const journal = recovery;
    recovery = null;
    sync.recover(journal);
    $("draft-recovery").hidden = true;
  } catch (error) {
    recovery = null;
    $("warning").textContent = "Cannot recover draft: " + error.message;
    $("warning").hidden = false;
  }
};
$("discard-draft").onclick = () => {
  recovery = null;
  $("draft-recovery").hidden = true;
  changed();
};
function endLifecycle(dialog) {
  $(dialog).close();
  lifecycle = false;
  sync.release();
}
$("new-btn").onclick = () => {
  lifecycle = true;
  sync.hold();
  $("new-error").textContent = "";
  $("new-dialog").showModal();
};
$("cancel-new").onclick = () => endLifecycle("new-dialog");
$("new-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  endLifecycle("new-dialog");
});
async function replaceBoard(url, body) {
  const response = await request(url, {
    ...body,
    expectedRevision: sync.remote.revision,
  });
  if (!response.ok) {
    if (response.status === 409) sync.receive(response.body);
    throw new Error(response.body.error || "Operation failed");
  }
  sync.base = clone(response.body.board);
  sync.draft = clone(response.body.board);
  sync.remote = response.body;
  sync.undoStack = [];
  sync.redoStack = [];
  selected.clear();
  sync.error = "";
  sync.status = "Saved";
}
$("new-form").onsubmit = async (e) => {
  e.preventDefault();
  const button = e.submitter;
  button.disabled = true;
  try {
    const board = starter();
    board.workshopId = crypto.randomUUID();
    board.title += " — " + $("new-domain").value.trim();
    board.purpose = $("new-purpose").value;
    board.phase = PURPOSES[board.purpose].phases[0];
    await replaceBoard("/api/board", { board, archive: true });
    endLifecycle("new-dialog");
  } catch (error) {
    $("new-error").textContent =
      error.message +
      " Close and reopen to review the latest board before retrying.";
  } finally {
    button.disabled = false;
  }
};
$("history-btn").onclick = async () => {
  lifecycle = true;
  sync.hold();
  $("history-error").textContent = "";
  $("history-list").replaceChildren();
  $("history-dialog").showModal();
  try {
    const response = await request("/api/history");
    if (!response.ok) throw new Error(response.body.error);
    for (const entry of response.body) {
      const row = document.createElement("div");
      row.className = "history-row";
      const label = document.createElement("span");
      label.textContent = entry.name;
      const preview = document.createElement("button");
      preview.textContent = "Export";
      preview.onclick = async () => {
        try {
          const result = await request(
            "/api/history?name=" + encodeURIComponent(entry.name),
          );
          if (!result.ok) throw new Error(result.body.error);
          download(result.body, entry.name);
        } catch (error) {
          $("history-error").textContent = error.message;
        }
      };
      const restore = document.createElement("button");
      restore.textContent = "Restore";
      restore.onclick = async () => {
        if (
          !window.confirm(
            "Restore this snapshot for everyone? The current valid board will be archived.",
          )
        )
          return;
        restore.disabled = true;
        try {
          await replaceBoard("/api/restore", { name: entry.name });
          endLifecycle("history-dialog");
        } catch (error) {
          $("history-error").textContent = error.message;
        } finally {
          restore.disabled = false;
        }
      };
      row.append(label, preview, restore);
      $("history-list").append(row);
    }
  } catch (error) {
    $("history-error").textContent = error.message;
  }
};
$("close-history").onclick = () => endLifecycle("history-dialog");
$("history-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  endLifecycle("history-dialog");
});
window.addEventListener("beforeunload", (e) => {
  if (sync.dirty || sync.busy || sync.held || sync.conflicts.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});
const stream = new EventSource("/api/stream");
stream.addEventListener("board", (event) => {
  try {
    sync.receive(JSON.parse(event.data));
  } catch (error) {
    $("warning").hidden = false;
    $("warning").textContent = "Incoming board rejected: " + error.message;
  }
});
stream.addEventListener("open", () => {
  $("conn").textContent = "Live";
  $("conn").className = "badge live";
});
stream.addEventListener("error", () => {
  $("conn").textContent = "Reconnecting…";
  $("conn").className = "badge down";
});

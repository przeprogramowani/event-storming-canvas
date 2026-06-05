// Event Storming board client.
// Renders board.json, syncs live over SSE, writes human edits via POST /api/board.
//
// The board's vocabulary is Event Storming, not generic shapes. Every sticky has
// a `role` (domain event, command, actor, policy, …). Colors, lanes and the
// phase-gated toolbar encode the method so the flow is hard to do "wrong".

const boardEl = document.getElementById("board");
const lanesEl = document.getElementById("lanes");
const titleEl = document.getElementById("board-title");
const connEl = document.getElementById("conn");
const savedEl = document.getElementById("saved");
const deleteBtn = document.getElementById("delete-btn");
const toolsEl = document.getElementById("tools");
const legendEl = document.getElementById("legend");
const phaseSel = document.getElementById("phase");
const phaseHint = document.getElementById("phase-hint");

const CONTENT_W = 3600;
const CONTENT_H = 880;

// ---- Event Storming legend: role -> color, default size, home lane (y) -------
const ROLES = {
  event:     { label: "Event",     tag: "DOMAIN EVENT",    bg: "#ffb86b", w: 170, h: 104, y: 330 },
  hotspot:   { label: "Hotspot",   tag: "⚡ HOTSPOT",       bg: "#ff8787", w: 150, h: 104, y: 338, rotate: -4 },
  command:   { label: "Command",   tag: "COMMAND",         bg: "#74c0fc", w: 170, h: 104, y: 200 },
  actor:     { label: "Actor",     tag: "ACTOR",           bg: "#ffe066", w: 120, h: 86,  y: 92  },
  readmodel: { label: "Read Model",tag: "READ MODEL",      bg: "#8ce99a", w: 170, h: 104, y: 458 },
  policy:    { label: "Policy",    tag: "POLICY",          bg: "#d0bfff", w: 196, h: 104, y: 586 },
  external:  { label: "External",  tag: "EXTERNAL SYSTEM", bg: "#fcc2d7", w: 170, h: 104, y: 716 },
  aggregate: { label: "Aggregate", tag: "AGGREGATE",       bg: "#ffe8a3", w: 232, h: 150, y: 568, border: true },
  label:     { label: "Label",     tag: "",                bg: null,      w: 0,   h: 0,   y: 0   },
};
const ROLE_ORDER = ["event", "hotspot", "command", "actor", "readmodel", "policy", "external", "aggregate", "label"];

// ---- Swimlanes (visual guides only — never stored in board.json) -------------
const LANES = [
  { label: "ACTORS",                   y: 60,  h: 130 },
  { label: "COMMANDS",                 y: 190, h: 120 },
  { label: "DOMAIN EVENTS   ➜  time",  y: 310, h: 130, spine: true },
  { label: "READ MODELS",              y: 440, h: 120 },
  { label: "POLICIES & AGGREGATES",    y: 560, h: 140 },
  { label: "EXTERNAL SYSTEMS",         y: 700, h: 140 },
];

// ---- Phase flow: each phase unlocks the roles you should be adding -----------
const PHASES = {
  "chaotic-exploration": {
    label: "1 · Chaotic Exploration",
    allow: ["event"],
    hint: 'Flood the board with domain events. Past tense ("Order Placed"). One per sticky. Don\'t order them yet.',
  },
  "timeline": {
    label: "2 · Enforce the Timeline",
    allow: ["event"],
    hint: "Arrange events left → right in the order they happen. Merge duplicates; gaps reveal missing steps.",
  },
  "hotspots": {
    label: "3 · Pain Points & Hotspots",
    allow: ["event", "hotspot"],
    hint: "Mark problems, risks and open questions with red hotspots, right on the timeline.",
  },
  "commands-actors": {
    label: "4 · Commands & Actors",
    allow: ["event", "hotspot", "command", "actor"],
    hint: 'What command caused each event (blue, imperative: "Place Order")? Who issues it (yellow actor)?',
  },
  "models-policies": {
    label: "5 · Read Models, Policies & Systems",
    allow: ["event", "hotspot", "command", "actor", "readmodel", "policy", "external"],
    hint: 'Add read models actors rely on (green), reactive policies (purple, "whenever… then…"), external systems (pink).',
  },
  "aggregates": {
    label: "6 · Aggregates & Boundaries",
    allow: ROLE_ORDER.slice(),
    hint: "Cluster commands + events around the aggregates that enforce their rules. Name bounded contexts with labels.",
  },
};
const DEFAULT_PHASE = "chaotic-exploration";

let board = { title: "Event Storming", phase: DEFAULT_PHASE, items: [] };
let selectedId = null;
let locked = null; // id of item being dragged/edited — protected from remote re-render
let addCount = 0;

function roleOf(item) {
  return ROLES[item.role] ? item.role : "event";
}
function currentPhase() {
  return PHASES[board.phase] ? board.phase : DEFAULT_PHASE;
}

// ---------- one-time chrome: lanes, toolbar, phase select, legend ----------
function buildLanes() {
  lanesEl.style.width = CONTENT_W + "px";
  lanesEl.style.height = CONTENT_H + "px";
  for (const lane of LANES) {
    const el = document.createElement("div");
    el.className = "lane" + (lane.spine ? " spine" : "");
    el.style.top = lane.y + "px";
    el.style.height = lane.h + "px";
    el.style.width = CONTENT_W + "px";
    const lbl = document.createElement("span");
    lbl.className = "lane-label";
    lbl.textContent = lane.label;
    el.appendChild(lbl);
    lanesEl.appendChild(el);
  }
}

function buildToolbar() {
  for (const role of ROLE_ORDER) {
    const def = ROLES[role];
    const btn = document.createElement("button");
    btn.className = "tool";
    btn.dataset.role = role;
    const dot = document.createElement("span");
    dot.className = "tool-dot";
    dot.style.background = def.bg || "transparent";
    dot.style.boxShadow = def.bg ? "" : "inset 0 0 0 1px #adb5bd";
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(def.label));
    btn.onclick = () => addItem(role);
    toolsEl.appendChild(btn);
  }
}

function buildPhaseSelect() {
  for (const [key, def] of Object.entries(PHASES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = def.label;
    phaseSel.appendChild(opt);
  }
  phaseSel.onchange = () => {
    board.phase = phaseSel.value;
    updatePhaseUI();
    save();
  };
}

function buildLegend() {
  for (const role of ROLE_ORDER) {
    if (role === "label") continue;
    const def = ROLES[role];
    const chip = document.createElement("span");
    chip.className = "legend-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = def.bg;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(def.tag));
    legendEl.appendChild(chip);
  }
}

function updatePhaseUI() {
  const ph = PHASES[currentPhase()];
  phaseSel.value = currentPhase();
  phaseHint.textContent = ph.hint;
  const allow = new Set(ph.allow);
  allow.add("label"); // annotations are always allowed
  [...toolsEl.children].forEach((btn) => {
    btn.disabled = !allow.has(btn.dataset.role);
  });
}

// ---------- rendering ----------
function render() {
  titleEl.textContent = board.title || "Event Storming";
  updatePhaseUI();

  const ids = new Set(board.items.map((i) => i.id));
  [...boardEl.children].forEach((el) => {
    if (!el.dataset.id) return; // skip the lanes layer
    if (!ids.has(el.dataset.id)) el.remove();
  });

  for (const item of board.items) {
    if (item.id === locked) continue; // don't disturb a live drag/edit
    let el = boardEl.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
    if (!el) {
      el = document.createElement("div");
      el.dataset.id = item.id;
      boardEl.appendChild(el);
      attachHandlers(el);
    }
    paint(el, item);
  }
}

function paint(el, item) {
  const role = roleOf(item);
  const def = ROLES[role];
  el.className = "item";
  el.style.left = item.x + "px";
  el.style.top = item.y + "px";
  el.style.transform = def.rotate ? `rotate(${def.rotate}deg)` : "";

  if (role === "label") {
    el.classList.add("text");
    el.dataset.tag = "";
    el.style.background = "";
    el.style.color = item.color || "#1f2933";
    el.style.fontSize = (item.fontSize || 22) + "px";
    el.style.width = "";
    el.style.height = "";
  } else {
    el.classList.add("sticky", "role-" + role);
    el.dataset.tag = def.tag;
    el.style.background = item.color || def.bg;
    el.style.color = "";
    el.style.fontSize = "";
    el.style.width = (item.width || def.w) + "px";
    el.style.height = (item.height || def.h) + "px";
  }
  el.textContent = item.text || "";
  if (item.id === selectedId) el.classList.add("selected");
}

// ---------- interaction ----------
function attachHandlers(el) {
  let startX, startY, origX, origY, moved;

  el.addEventListener("mousedown", (e) => {
    if (el.getAttribute("contenteditable") === "true") return;
    const item = board.items.find((i) => i.id === el.dataset.id);
    if (!item) return;
    select(item.id);
    locked = item.id;
    moved = false;
    startX = e.clientX; startY = e.clientY;
    origX = item.x; origY = item.y;
    el.classList.add("dragging");

    const onMove = (ev) => {
      moved = true;
      item.x = Math.max(0, origX + (ev.clientX - startX));
      item.y = Math.max(0, origY + (ev.clientY - startY));
      el.style.left = item.x + "px";
      el.style.top = item.y + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      el.classList.remove("dragging");
      locked = null;
      if (moved) save();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  el.addEventListener("dblclick", () => {
    const item = board.items.find((i) => i.id === el.dataset.id);
    if (!item) return;
    locked = item.id;
    el.setAttribute("contenteditable", "true");
    el.focus();
    document.execCommand("selectAll", false, null);

    const finish = () => {
      el.removeAttribute("contenteditable");
      item.text = el.innerText.trim();
      locked = null;
      el.removeEventListener("blur", finish);
      el.removeEventListener("keydown", onKey);
      render();
      save();
    };
    const onKey = (e) => {
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        el.blur();
      }
    };
    el.addEventListener("blur", finish);
    el.addEventListener("keydown", onKey);
  });
}

function select(id) {
  selectedId = id;
  deleteBtn.disabled = !id;
  [...boardEl.children].forEach((el) =>
    el.classList.toggle("selected", !!el.dataset.id && el.dataset.id === id)
  );
}

boardEl.addEventListener("mousedown", (e) => {
  if (e.target === boardEl || e.target === lanesEl) select(null);
});

// ---------- add / delete ----------
function deleteSelected() {
  if (!selectedId) return;
  board.items = board.items.filter((i) => i.id !== selectedId);
  select(null);
  render();
  save(); // POSTs to /api/board -> writes board.json -> AI moderator sees it too
}
deleteBtn.onclick = deleteSelected;

document.addEventListener("keydown", (e) => {
  if (e.key !== "Backspace" && e.key !== "Delete") return;
  const editing =
    document.activeElement &&
    document.activeElement.getAttribute("contenteditable") === "true";
  if (editing) return; // let the keypress edit text instead
  if (!selectedId) return;
  e.preventDefault();
  deleteSelected();
});

function addItem(role) {
  const def = ROLES[role];
  const id = role + "-" + Math.random().toString(36).slice(2, 7);
  const x = boardEl.scrollLeft + 60 + (addCount % 8) * 36;
  const y = role === "label" ? boardEl.scrollTop + 70 : def.y;
  addCount++;

  const placeholders = {
    event: "Something Happened",
    command: "Do Something",
    actor: "Role",
    policy: "Whenever … then …",
    readmodel: "Info to decide",
    external: "External System",
    aggregate: "Aggregate",
    hotspot: "Question / risk?",
    label: "Bounded Context",
  };

  const item = { id, role, text: placeholders[role] || "", x, y };
  if (role === "label") item.fontSize = 22;
  board.items.push(item);
  render();
  select(id);
  save();
}

// ---------- persistence ----------
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(board),
      });
      savedEl.textContent = "saved";
      setTimeout(() => (savedEl.textContent = ""), 1200);
    } catch {
      savedEl.textContent = "save failed";
    }
  }, 150);
}

// ---------- live stream ----------
function connect() {
  const es = new EventSource("/api/stream");
  es.addEventListener("open", () => {
    connEl.textContent = "live";
    connEl.className = "badge live";
  });
  es.addEventListener("board", (e) => {
    try {
      const incoming = JSON.parse(e.data);
      if (locked) {
        // keep the sticky the human is dragging/editing right now
        const mine = board.items.find((i) => i.id === locked);
        board = incoming;
        if (mine) {
          const idx = board.items.findIndex((i) => i.id === locked);
          if (idx >= 0) board.items[idx] = mine;
        }
      } else {
        board = incoming;
      }
      if (!PHASES[board.phase]) board.phase = DEFAULT_PHASE;
      render();
    } catch {}
  });
  es.addEventListener("error", () => {
    connEl.textContent = "reconnecting…";
    connEl.className = "badge down";
  });
}

// ---------- boot ----------
buildLanes();
buildToolbar();
buildPhaseSelect();
buildLegend();
connect();

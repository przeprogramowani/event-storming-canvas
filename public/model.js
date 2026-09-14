// Shared board vocabulary and validation: loaded by both Node and the browser.
(function (root, factory) {
  const model = factory();
  if (typeof module === "object") module.exports = model;
  else root.BoardModel = model;
})(globalThis, function () {
  const ROLES = {
    event: {
      label: "Event",
      tag: "DOMAIN EVENT",
      bg: "#ffb86b",
      w: 170,
      h: 104,
      y: 330,
    },
    hotspot: {
      label: "Hotspot",
      tag: "HOTSPOT",
      bg: "#ff8787",
      w: 170,
      h: 120,
      y: 338,
    },
    command: {
      label: "Command",
      tag: "COMMAND",
      bg: "#74c0fc",
      w: 170,
      h: 104,
      y: 200,
    },
    actor: {
      label: "Actor",
      tag: "ACTOR",
      bg: "#ffe066",
      w: 120,
      h: 86,
      y: 92,
    },
    readmodel: {
      label: "Read Model",
      tag: "READ MODEL",
      bg: "#8ce99a",
      w: 170,
      h: 104,
      y: 458,
    },
    policy: {
      label: "Policy",
      tag: "POLICY",
      bg: "#d0bfff",
      w: 196,
      h: 104,
      y: 586,
    },
    external: {
      label: "External System",
      tag: "EXTERNAL SYSTEM",
      bg: "#fcc2d7",
      w: 170,
      h: 104,
      y: 716,
    },
    aggregate: {
      label: "Aggregate",
      tag: "AGGREGATE",
      bg: "#ffe8a3",
      w: 232,
      h: 150,
      y: 568,
    },
    label: {
      label: "Annotation",
      tag: "ANNOTATION",
      bg: null,
      w: 240,
      h: 60,
      y: 40,
    },
    frame: {
      label: "Frame",
      tag: "SCENARIO / BOUNDARY",
      bg: null,
      w: 640,
      h: 460,
      y: 60,
    },
  };
  const PHASES = {
    "chaotic-exploration": {
      label: "Explore events",
      roles: ["event"],
      hint: "Invite independent perspectives. Past tense, one occurrence per sticky; suggestions need expert confirmation.",
      done: "Have the relevant people contributed, including stories that disagree?",
    },
    timeline: {
      label: "Tell the story",
      roles: ["event"],
      hint: "Read the story aloud. Arrange narrative order; preserve alternatives and parallel activity in separate frames.",
      done: "Can participants tell the story forward and backward, including missing steps?",
    },
    hotspots: {
      label: "Investigate hotspots",
      roles: ["event"],
      hint: "Capture uncertainty, pain and opportunities. Preserve disagreements; identify whose knowledge is missing.",
      done: "Which questions matter most, and who can help answer them?",
    },
    "commands-actors": {
      label: "Explore triggers",
      roles: ["event", "command", "actor", "external"],
      hint: "What triggered the event: a person’s intent, a rule, an external occurrence or time? Explore rejection and no-change outcomes.",
      done: "Have you covered automation, failure, rejection and retries without inventing a human actor?",
    },
    "models-policies": {
      label: "Decisions and rules",
      roles: ["event", "command", "actor", "external", "readmodel", "policy"],
      hint: "What information supports the decision? Whenever an event occurs, what rule reacts? Identify loop termination conditions.",
      done: "Have you walked through normal, alternative and failure scenarios, including timeouts?",
    },
    aggregates: {
      label: "Consistency and boundaries",
      roles: Object.keys(ROLES),
      hint: "Record invariants before proposing aggregates. Use context frames for language/model boundaries, not just entity groups.",
      done: "Which rules must hold together? What evidence supports each candidate boundary?",
    },
    closure: {
      label: "Decisions and next steps",
      roles: ["event"],
      hint: "Prioritize hotspots. Record decisions, assumptions, owners and next steps in the workshop notes.",
      done: "Does each important open question have an owner and a next action?",
    },
  };
  const PURPOSES = {
    "big-picture": {
      label: "Big Picture",
      structured: false,
      description: "Explore events and questions freely.",
      roles: ["event", "hotspot", "label", "frame"],
      phases: ["chaotic-exploration", "timeline", "hotspots", "closure"],
    },
    "process-modelling": {
      label: "Process Modelling",
      structured: true,
      description:
        "Trace actions, outcomes and business rules in expanding lanes.",
      roles: [
        "event",
        "hotspot",
        "command",
        "actor",
        "readmodel",
        "policy",
        "external",
        "label",
        "frame",
      ],
      phases: [
        "timeline",
        "hotspots",
        "commands-actors",
        "models-policies",
        "closure",
      ],
    },
    "software-design": {
      label: "Software Design",
      structured: true,
      description:
        "Model behavior and consistency boundaries in expanding lanes.",
      roles: Object.keys(ROLES),
      phases: [
        "timeline",
        "hotspots",
        "commands-actors",
        "models-policies",
        "aggregates",
        "closure",
      ],
    },
  };
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])]),
      );
    return value;
  };
  const equal = (a, b) =>
    JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  function starter() {
    return {
      title: "Event Storming",
      workshopId: "legacy",
      purpose: "big-picture",
      phase: "chaotic-exploration",
      items: [],
      notes: "",
    };
  }
  function validate(input) {
    const fail = (message) => {
      throw new Error(message);
    };
    const object = (value) =>
      value && typeof value === "object" && !Array.isArray(value);
    const string = (value, max, name) => {
      if (typeof value !== "string" || value.length > max)
        fail(`${name} must be text, at most ${max} characters`);
    };
    if (!object(input)) fail("Board must be an object");
    const safeKeys = (value) => {
      if (!value || typeof value !== "object") return;
      for (const key of Object.keys(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
          fail("Reserved property name");
        safeKeys(value[key]);
      }
    };
    safeKeys(input);
    string(input.title, 300, "Title");
    if (input.workshopId !== undefined)
      string(input.workshopId, 100, "Workshop ID");
    if (!own(PHASES, input.phase)) fail("Unknown workshop phase");
    if (input.purpose !== undefined && !own(PURPOSES, input.purpose))
      fail("Unknown workshop purpose");
    if (!Array.isArray(input.items) || input.items.length > 2000)
      fail("Board must have an items array with at most 2000 items");
    if (input.notes !== undefined) string(input.notes, 20000, "Workshop notes");
    const ids = new Set();
    for (const item of input.items) {
      if (!object(item)) fail("Every item must be an object");
      if (
        typeof item.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) ||
        ["__proto__", "constructor", "prototype"].includes(item.id) ||
        ids.has(item.id)
      )
        fail(
          "Item IDs must be unique nonreserved letters, digits, hyphens or underscores",
        );
      ids.add(item.id);
      if (!own(ROLES, item.role)) fail(`Unknown role on ${item.id}`);
      string(item.text, 4000, `Text on ${item.id}`);
      for (const key of ["x", "y"])
        if (!Number.isFinite(item[key]) || item[key] < 0 || item[key] > 100000)
          fail(`Invalid ${key} on ${item.id}`);
      for (const key of ["width", "height", "fontSize"])
        if (
          item[key] !== undefined &&
          (!Number.isFinite(item[key]) ||
            item[key] < 1 ||
            item[key] > (key === "fontSize" ? 100 : 10000))
        )
          fail(`Invalid ${key} on ${item.id}`);
      if (item.color !== undefined && !/^#[\da-fA-F]{6}$/.test(item.color))
        fail(`Invalid color on ${item.id}`);
      if (
        item.status !== undefined &&
        !["suggested", "confirmed"].includes(item.status)
      )
        fail(`Invalid status on ${item.id}`);
      if (
        item.priority !== undefined &&
        !["high", "medium", "low"].includes(item.priority)
      )
        fail(`Invalid priority on ${item.id}`);
      for (const key of [
        "source",
        "owner",
        "nextStep",
        "invariant",
        "termination",
        "frameId",
        "frameKind",
      ])
        if (item[key] !== undefined)
          string(item[key], 1000, `${key} on ${item.id}`);
      if (
        item.frameKind !== undefined &&
        !["scenario", "context", "aggregate", "conversational"].includes(
          item.frameKind,
        )
      )
        fail(`Invalid frame kind on ${item.id}`);
    }
    const frames = new Set(
      input.items
        .filter((item) => item.role === "frame")
        .map((item) => item.id),
    );
    for (const item of input.items)
      if (item.frameId && (!frames.has(item.frameId) || item.role === "frame"))
        fail(`Invalid frame membership on ${item.id}`);
    const board = clone(input);
    board.workshopId ||= "legacy";
    // Migrate legacy boards in memory, without rewriting or repositioning their items.
    board.purpose ||=
      board.phase === "aggregates"
        ? "software-design"
        : ["commands-actors", "models-policies"].includes(board.phase)
          ? "process-modelling"
          : "big-picture";
    if (!PURPOSES[board.purpose].phases.includes(board.phase))
      fail("Phase is not available for this workshop purpose");
    board.notes ||= "";
    return board;
  }
  function allowedRoles(board, override = false) {
    return override
      ? Object.keys(ROLES)
      : [
          ...new Set([
            ...PHASES[board.phase].roles,
            "hotspot",
            "label",
            "frame",
          ]),
        ];
  }
  // Field-level three-way merge: independent edits combine; competing edits remain explicit.
  function merge(base, local, remote, choice = {}) {
    const conflicts = [];
    function value(b, l, r, key) {
      if (equal(l, b)) return r;
      if (equal(r, b) || equal(l, r)) return l;
      if (!own(choice, key)) conflicts.push({ key, local: l, remote: r });
      return choice[key] === "remote" ? r : l;
    }
    function fields(b, l, r, prefix) {
      const out = {};
      for (const key of new Set([
        ...Object.keys(b),
        ...Object.keys(l),
        ...Object.keys(r),
      ])) {
        if (key === "updatedAt" || key === "items") continue;
        if (prefix === "board." && ["purpose", "phase"].includes(key)) continue;
        const next = value(b[key], l[key], r[key], `${prefix}${key}`);
        if (next !== undefined) out[key] = next;
      }
      return out;
    }
    if ((base.workshopId || "legacy") !== (remote.workshopId || "legacy")) {
      return {
        board: clone(value(base, local, remote, "board.workshop")),
        conflicts,
      };
    }
    const board = fields(base, local, remote, "board.");
    const workflow = (b) => ({ purpose: b.purpose, phase: b.phase });
    Object.assign(
      board,
      value(
        workflow(base),
        workflow(local),
        workflow(remote),
        "board.workflow",
      ),
    );
    const maps = [base, local, remote].map(
      (b) => new Map(b.items.map((i) => [i.id, i])),
    );
    board.items = [];
    for (const id of new Set([
      ...maps[2].keys(),
      ...maps[1].keys(),
      ...maps[0].keys(),
    ])) {
      const [b, l, r] = maps.map((m) => m.get(id));
      const item = b && l && r ? fields(b, l, r, `${id}.`) : value(b, l, r, id);
      if (item) board.items.push(clone(item));
    }
    if (remote.updatedAt) board.updatedAt = remote.updatedAt;
    return { board, conflicts };
  }
  return {
    ROLES,
    PHASES,
    PURPOSES,
    starter,
    validate,
    allowedRoles,
    merge,
    clone,
    equal,
    canonical,
  };
});

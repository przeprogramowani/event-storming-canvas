// A derived view: role lanes never rewrite participants' free-form coordinates.
(function (root, factory) {
  if (typeof module === "object") module.exports = factory(require("./model"));
  else root.BoardLayout = factory(root.BoardModel);
})(globalThis, function ({ ROLES }) {
  const GROUPS = [
    ["annotations", "ANNOTATIONS", ["label"]],
    ["actors", "ACTORS", ["actor"]],
    ["commands", "COMMANDS", ["command"]],
    ["events", "EVENTS & HOTSPOTS · narrative order →", ["event", "hotspot"]],
    ["readmodels", "READ MODELS", ["readmodel"]],
    ["policies", "POLICIES / CONSISTENCY", ["policy", "aggregate"]],
    ["external", "EXTERNAL SYSTEMS", ["external"]],
  ];
  const dimensions = (item) => ({
    w: item.width || ROLES[item.role].w,
    h: item.height || ROLES[item.role].h,
  });
  function layout(items, enabled, visibleRoles = Object.keys(ROLES)) {
    const positions = new Map(items.map((item) => [item.id, { ...item }]));
    const lanes = [];
    if (!enabled) return { positions, lanes };
    let top = 24;
    for (const [id, label, roles] of GROUPS) {
      if (
        !roles.some(
          (role) =>
            visibleRoles.includes(role) ||
            items.some((item) => item.role === role && !item.frameId),
        )
      )
        continue;
      const cards = items
        .filter((item) => !item.frameId && roles.includes(item.role))
        .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
      if (id === "annotations" && !cards.length) continue;
      const placed = [];
      const origin =
        id === "annotations" ? Math.min(...cards.map((item) => item.y)) : null;
      let bottom = top + 120;
      for (const card of cards) {
        const size = dimensions(card);
        let y = top + 36 + Math.max(0, card.y - (origin ?? ROLES[card.role].y));
        // Keep narrative X; stack only cards whose horizontal footprints collide.
        for (const other of placed.sort((a, b) => a.y - b.y)) {
          const bounds = dimensions(other);
          if (
            card.x < other.x + bounds.w + 20 &&
            card.x + size.w + 20 > other.x &&
            y < other.y + bounds.h + 20 &&
            y + size.h + 20 > other.y
          )
            y = other.y + bounds.h + 20;
        }
        const shown = { ...card, y };
        placed.push(shown);
        positions.set(card.id, shown);
        bottom = Math.max(bottom, y + size.h + 24);
      }
      lanes.push({
        id,
        label:
          id === "policies" &&
          !visibleRoles.includes("aggregate") &&
          !cards.some((card) => card.role === "aggregate")
            ? "POLICIES"
            : label,
        y: top,
        h: bottom - top,
      });
      top = bottom;
    }
    // Scenario frames keep their internal geometry and live outside global role lanes.
    const frames = items.filter((item) => item.role === "frame");
    if (frames.length) {
      const shift = top + 40;
      for (const item of items)
        if (item.role === "frame" || item.frameId)
          positions.set(item.id, { ...item, y: item.y + shift });
    }
    return { positions, lanes };
  }
  return { layout, dimensions };
});

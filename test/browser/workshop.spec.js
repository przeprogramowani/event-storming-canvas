const { test: base, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createBoardServer } = require("../../server");
const { atomicWrite } = require("../../lib/store");
const { starter } = require("../../public/model");
const test = base.extend({
  workshop: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storm-browser-"));
    const file = path.join(dir, "board.json");
    atomicWrite(file, {
      ...starter(),
      items: [
        { id: "evt-a", role: "event", text: "Order placed", x: 120, y: 330 },
      ],
    });
    const app = createBoardServer({ file });
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
    try {
      await use({
        ...app,
        url: `http://127.0.0.1:${app.server.address().port}`,
      });
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
});
async function visit(page, workshop) {
  await page.goto(workshop.url);
  await expect(page.locator("#saved")).toHaveText("Saved");
}
const sticky = (page) => page.locator('[data-id="evt-a"]');
test("keyboard movement, text editing, Escape, undo and redo", async ({
  page,
  workshop,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await visit(page, workshop);
  await sticky(page).focus();
  await sticky(page).press("ArrowRight");
  await expect.poll(() => workshop.store.board.items[0].x).toBe(130);
  await sticky(page).press("Enter");
  await page.locator("#item-text").fill("Cancelled edit");
  await page.keyboard.press("Escape");
  await expect(sticky(page)).toContainText("Order placed");
  await sticky(page).focus();
  await sticky(page).press("Enter");
  await page.locator("#item-text").fill("Order confirmed");
  await page.getByRole("button", { name: "Save sticky", exact: true }).click();
  await expect
    .poll(() => workshop.store.board.items[0].text)
    .toBe("Order confirmed");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(() => workshop.store.board.items[0].text)
    .toBe("Order placed");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect
    .poll(() => workshop.store.board.items[0].text)
    .toBe("Order confirmed");
  expect(errors).toEqual([]);
});
test("two participants resolve competing text without losing an independent agent change", async ({
  page,
  context,
  workshop,
}) => {
  await visit(page, workshop);
  const other = await context.newPage();
  await visit(other, workshop);
  for (const p of [page, other]) {
    await sticky(p).focus();
    await sticky(p).press("Enter");
  }
  await page.locator("#item-text").fill("Participant one");
  await other.locator("#item-text").fill("Participant two");
  await page.getByRole("button", { name: "Save sticky", exact: true }).click();
  await expect
    .poll(() => workshop.store.board.items[0].text)
    .toBe("Participant one");
  const current = workshop.store.state();
  current.board.notes = "Agent investigated timeout";
  workshop.store.commit(current.board, current.revision);
  await other.getByRole("button", { name: "Save sticky", exact: true }).click();
  await expect(other.locator("#conflicts")).toBeVisible();
  await expect(other.locator("#conflicts")).toContainText("Participant one");
  await other
    .getByRole("button", { name: "Keep my change", exact: true })
    .click();
  await expect
    .poll(() => workshop.store.board.items[0].text)
    .toBe("Participant two");
  expect(workshop.store.board.notes).toBe("Agent investigated timeout");
  await expect(sticky(page)).toContainText("Participant two");
});
test("failed save retains draft, reload recovery and explicit retry", async ({
  page,
  workshop,
}) => {
  await visit(page, workshop);
  await page.route("**/api/board", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Storage unavailable" }),
        })
      : route.continue(),
  );
  await sticky(page).focus();
  await sticky(page).press("ArrowRight");
  await expect(page.locator("#saved")).toContainText("Storage unavailable");
  expect(workshop.store.board.items[0].x).toBe(120);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator("#draft-recovery")).toBeVisible();
  await page
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(page.locator("#saved")).toContainText("Storage unavailable");
  await page.unroute("**/api/board");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect.poll(() => workshop.store.board.items[0].x).toBe(130);
  await expect(page.locator("#saved")).toHaveText("Saved");
});
test("workshop purpose, early hotspots, closure notes and suggestions", async ({
  page,
  workshop,
}) => {
  await visit(page, workshop);
  await expect(page.locator("#lanes")).toBeHidden();
  await expect(page.locator("#phase, #guides, #override")).toHaveCount(0);
  await expect(page.locator('#tools [data-role="hotspot"]')).toBeVisible();
  await expect(page.locator('#tools [data-role="aggregate"]')).toBeHidden();
  await page.locator('#tools [data-role="hotspot"]').click();
  await page.locator("#item-text").fill("What happens when payment times out?");
  await page.locator("#item-status").selectOption("suggested");
  await page.locator("#item-source").fill("AI");
  await page.locator("#item-owner").fill("Payments expert");
  await page.locator("#item-priority").selectOption("high");
  await page.locator("#item-nextStep").fill("Review provider retry contract");
  await page.getByRole("button", { name: "Save sticky", exact: true }).click();
  await expect(page.locator("#saved")).toHaveText("Saved");
  await page.locator("#purpose").selectOption("software-design");
  await expect(page.locator("#lanes")).toBeVisible();
  await expect(page.locator('#tools [data-role="aggregate"]')).toBeVisible();

  await page.locator(".workshop-menu summary").click();
  await page
    .getByRole("button", { name: "Workshop notes", exact: true })
    .click();
  await page
    .locator("#notes-text")
    .fill(
      "Decision: retry after checking provider status. Owner: Payments expert.",
    );
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await expect
    .poll(() => workshop.store.board.notes)
    .toContain("Owner: Payments expert");
  expect(
    workshop.store.board.items.find((i) => i.role === "hotspot"),
  ).toMatchObject({
    status: "suggested",
    source: "AI",
    priority: "high",
    owner: "Payments expert",
  });
});
test("frame membership moves together and deleting a frame preserves its members", async ({
  page,
  workshop,
}) => {
  const current = workshop.store.state();
  current.board.items.push({
    id: "frame-a",
    role: "frame",
    text: "Payment retries",
    x: 40,
    y: 60,
    width: 640,
    height: 460,
    frameKind: "conversational",
    termination: "Payment settled or expired",
  });
  current.board.items[0].frameId = "frame-a";
  workshop.store.commit(current.board, current.revision);
  await visit(page, workshop);
  const frame = page.locator('[data-id="frame-a"]');
  await frame.focus();
  await frame.press("ArrowRight");
  await expect
    .poll(() => workshop.store.board.items.find((i) => i.id === "frame-a").x)
    .toBe(50);
  expect(workshop.store.board.items[0].x).toBe(130);
  await frame.press("Delete");
  await expect.poll(() => workshop.store.board.items.length).toBe(1);
  expect(workshop.store.board.items[0].frameId).toBeUndefined();
});
test("new workshop archives old board and recovery restores it", async ({
  page,
  workshop,
}) => {
  await visit(page, workshop);
  await page.locator(".workshop-menu summary").click();
  await page.getByRole("button", { name: "New workshop", exact: true }).click();
  await page.locator("#new-domain").fill("Claims");
  await page
    .getByRole("button", { name: "Archive and start", exact: true })
    .click();
  await expect(page.locator("#board-title")).toHaveText(
    "Event Storming — Claims",
  );
  expect(workshop.store.board.items).toHaveLength(0);
  await page.locator(".workshop-menu summary").click();
  await page
    .getByRole("button", { name: "Recovery history", exact: true })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".history-row")
    .filter({ hasText: "-archive.json" })
    .first()
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await expect(sticky(page)).toContainText("Order placed");
  await expect(page.locator("#board-title")).toHaveText("Event Storming");
});
test("touch drag and mobile editor work without horizontal page overflow", async ({
  browser,
  workshop,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await visit(page, workshop);
    await page.getByRole("button", { name: "Fit board", exact: true }).click();
    const item = sticky(page);
    await item.scrollIntoViewIfNeeded();
    const box = await item.boundingBox();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + 30, y: box.y + 30 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: box.x + 60, y: box.y + 30 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => workshop.store.board.items[0].x)
      .toBeGreaterThan(120);
    await page
      .getByRole("button", { name: "Edit selected", exact: true })
      .click();
    await page.locator("#item-text").fill("Touch edited");
    await page
      .getByRole("button", { name: "Save sticky", exact: true })
      .click();
    await expect
      .poll(() => workshop.store.board.items[0].text)
      .toBe("Touch edited");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "test-results/mobile.png" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
test("representative board with branches, automation and loop has a usable overview", async ({
  page,
  workshop,
}) => {
  const board = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../fixtures/legacy-workshop.json")),
  );
  workshop.store.commit(board, workshop.store.revision);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await visit(page, workshop);
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  await expect(page.locator(".item")).toHaveCount(board.items.length);
  await page.screenshot({ path: "test-results/overview.png" });
  expect(errors).toEqual([]);
});

test("generic empty board asks for a domain and starts exploration without sample content", async ({
  page,
  workshop,
}) => {
  workshop.store.commit(starter(), workshop.store.revision);
  await visit(page, workshop);
  await expect(page.locator("#board-title")).toHaveText("Event Storming");
  await expect(page.locator("#welcome")).toBeVisible();
  await expect(page.locator(".item")).toHaveCount(0);
  await expect(page.locator("#purpose")).toHaveValue("big-picture");
  await page
    .getByLabel("Business process or domain", { exact: true })
    .fill("Insurance claims");
  await page
    .getByRole("button", { name: "Start exploration", exact: true })
    .click();
  await expect(page.locator("#welcome")).toBeHidden();
  await expect
    .poll(() => workshop.store.board.title)
    .toBe("Event Storming — Insurance claims");
  expect(workshop.store.board.items).toHaveLength(0);
  expect(workshop.store.board.phase).toBe("chaotic-exploration");
});

test("adaptive lanes contain misplaced commands, expand for additions, and preserve free layout", async ({
  page,
  workshop,
}) => {
  const board = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../fixtures/legacy-workshop.json")),
  );
  workshop.store.commit(board, workshop.store.revision);
  await visit(page, workshop);
  const inspect = () =>
    page.evaluate(() => {
      const lane = document.querySelector('[data-lane="commands"]');
      const cards = [...document.querySelectorAll(".item")].filter(
        (el) => el.querySelector(".item-tag")?.textContent === "COMMAND",
      );
      return {
        top: parseFloat(lane.style.top),
        bottom: parseFloat(lane.style.top) + parseFloat(lane.style.height),
        cards: cards.map((el) => ({
          top: parseFloat(el.style.top),
          bottom: parseFloat(el.style.top) + parseFloat(el.style.height),
        })),
        eventTop: parseFloat(
          document.querySelector('[data-lane="events"]').style.top,
        ),
      };
    });
  const before = await inspect();
  expect(
    before.cards.every(
      (card) => card.top >= before.top && card.bottom < before.bottom,
    ),
  ).toBe(true);
  const state = workshop.store.state();
  state.board.items.push({
    id: "cmd-extra",
    role: "command",
    text: "Retry operation",
    x: 140,
    y: 200,
    height: 500,
  });
  workshop.store.commit(state.board, state.revision);
  await expect
    .poll(async () => (await inspect()).eventTop)
    .toBeGreaterThan(before.eventTop);
  const after = await inspect();
  expect(
    after.cards.every(
      (card) => card.top >= after.top && card.bottom < after.bottom,
    ),
  ).toBe(true);
  const itemsBefore = JSON.stringify(workshop.store.board.items);
  await page.locator("#purpose").selectOption("big-picture");
  await expect(page.locator('[data-id="cmd-10"]')).toHaveCSS("top", "430px");
  expect(JSON.stringify(workshop.store.board.items)).toBe(itemsBefore);
  await page.locator("#purpose").selectOption("process-modelling");
  await page.getByRole("button", { name: "Fit board", exact: true }).click();
  await page.screenshot({ path: "test-results/adaptive-lanes.png" });
});

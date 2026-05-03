import { test, expect } from "@playwright/test";
import { PASTE_FIXTURE, FIXTURE_GAME_COUNT } from "./fixtures.js";

async function loadFixture(page) {
  await page.goto("/");
  await page.locator("#paste-toggle").click();
  await page.locator("#paste-input").fill(PASTE_FIXTURE);
  await page.locator("#paste-parse-btn").click();
  await expect(page.locator("#dashboard")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  // Hand the array back to each test via context.
  page.__errors = errors;
});

test.afterEach(async ({ page }) => {
  expect(page.__errors, page.__errors.join("\n")).toEqual([]);
});

test("page loads cleanly with dashboard hidden", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#url-input")).toBeVisible();
  await expect(page.locator("#load-btn")).toBeVisible();
  await expect(page.locator("#dashboard")).toBeHidden();
});

test("paste-toggle reveals the textarea", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#paste-input")).toBeHidden();
  await page.locator("#paste-toggle").click();
  await expect(page.locator("#paste-input")).toBeVisible();
});

test("paste import populates schedule and dashboard", async ({ page }) => {
  await loadFixture(page);
  const rows = page.locator("#schedule-table tbody tr");
  await expect(rows).toHaveCount(FIXTURE_GAME_COUNT);
});

test("calendar renders content after import", async ({ page }) => {
  await loadFixture(page);
  const calendar = page.locator("#calendar");
  await expect(calendar).not.toBeEmpty();
});

test("analysis panels are non-empty after import", async ({ page }) => {
  await loadFixture(page);
  for (const sel of [
    "#games-per-team",
    "#home-away",
    "#heatmap",
    "#monday-games",
    "#matchup-matrix",
    "#b2b-list",
  ]) {
    await expect(page.locator(sel), `panel ${sel} should not be empty`).not.toBeEmpty();
  }
});

test("swap suggestions render at least one card for a b2b-improvable schedule", async ({ page }) => {
  await loadFixture(page);
  const cards = page.locator("#swap-list .swap-card");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
});

test("changing time format updates the schedule slot column", async ({ page }) => {
  await loadFixture(page);
  // Default is 12h → "7:30 PM"-style.
  const firstSlotCell = page.locator("#schedule-table tbody tr").first().locator("td").nth(2);
  await expect(firstSlotCell).toContainText(/PM|AM/);
  await page.locator("#time-format").selectOption("24h");
  await expect(firstSlotCell).toContainText("19:30");
  await expect(firstSlotCell).not.toContainText(/PM|AM/);
});

test("applying a swap surfaces an Applied card with an Undo button", async ({ page }) => {
  await loadFixture(page);
  const applyBtn = page.locator("#swap-list .swap-card button.primary").first();
  await expect(applyBtn).toBeVisible();
  await applyBtn.click();

  const appliedCard = page.locator("#swap-list .swap-card--applied");
  await expect(appliedCard).toBeVisible();
  await expect(appliedCard.locator(".applied-badge")).toHaveText("Applied");
  await expect(appliedCard.locator("button.ghost")).toContainText("Undo");
});

test("undoing an applied swap removes the Applied card", async ({ page }) => {
  await loadFixture(page);
  await page.locator("#swap-list .swap-card button.primary").first().click();
  const appliedCard = page.locator("#swap-list .swap-card--applied");
  await expect(appliedCard).toBeVisible();

  await appliedCard.locator("button.ghost").click();
  await expect(page.locator("#swap-list .swap-card--applied")).toHaveCount(0);
  // A regular swap suggestion should still be present.
  await expect(page.locator("#swap-list .swap-card button.primary").first()).toBeVisible();
});

test("plan mode generates a schedule that flows into the dashboard", async ({ page }) => {
  await page.goto("/");
  await page.locator("#mode-plan-btn").click();
  await expect(page.locator("#plan-controls")).toBeVisible();
  await expect(page.locator("#analyze-controls")).toBeHidden();

  await page.locator("#plan-teams").fill("Alpha\nBravo\nCharlie\nDelta");
  await page.locator("#plan-start").fill("2026-09-07");
  await page.locator("#plan-end").fill("2026-10-05");
  // Target 2 games × 4 teams / 2 = 4 games needed; 5 slots available.
  await page.locator("#plan-target").fill("2");

  await page.locator("#plan-expand-btn").click();
  // Default pattern is Mon 21:00 every week — Sep 7..Oct 5 inclusive = 5 Mondays.
  await expect(page.locator("#plan-slot-count")).toHaveText("5 slots");

  await page.locator("#plan-generate-btn").click();
  await expect(page.locator("#dashboard")).toBeVisible();
  const rows = page.locator("#schedule-table tbody tr");
  expect(await rows.count()).toBeGreaterThan(0);
  await expect(page.locator("#calendar")).not.toBeEmpty();
  await expect(page.locator("#loaded-summary")).toContainText("Planned season");
});

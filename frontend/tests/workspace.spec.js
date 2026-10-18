import { test, expect } from '@playwright/test';

async function form(page) {
  const details = page.locator('.trip-details');
  if (!(await details.getAttribute('open') !== null)) await details.locator('summary').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Paris, France' })).toBeVisible();
});

test('loads real images, sources, allowances and all review views', async ({ page }) => {
  await expect(page.locator('.destination-banner img')).toBeVisible();
  expect(await page.locator('.destination-banner img').evaluate(image => image.complete && image.naturalWidth > 400)).toBeTruthy();
  await expect(page.getByText('Illustrative planning allowances. No bookings or live prices.')).toBeVisible();
  await page.getByRole('tab', { name: 'Budget', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Destination budget' })).toBeVisible();
  await page.getByRole('tab', { name: 'Travel & weather' }).click();
  await expect(page.getByText('No live forecast requested.')).toBeVisible();
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sources & limitations' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('changes destination and dates, saves, reloads, reopens and deletes', async ({ page }) => {
  await form(page);
  await page.getByRole('combobox', { name: 'Destination', exact: true }).selectOption('lisbon');
  await page.getByLabel('Start date').fill('2027-06-15');
  await page.getByLabel('Days', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Build itinerary', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lisbon, Portugal' })).toBeVisible();
  await expect(page.locator('.image-caption')).toContainText('Utilisateur ouikipedia (CC BY 4.0)');
  await page.getByRole('button', { name: 'Save trip', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved in this browser');
  await page.reload();
  await page.locator('.history-row > button').first().click();
  await expect(page.getByRole('heading', { name: 'Lisbon, Portugal' })).toBeVisible();
  await expect(page.locator('.day')).toHaveCount(3);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Lisbon trip' }).click();
  await expect(page.locator('.history-row')).toHaveCount(0);
});

test('handles real private API create, update, reopen and disconnect', async ({ page }) => {
  await page.getByRole('button', { name: 'Connect private planner', exact: true }).click();
  await page.getByLabel('Owner token').fill('fixture-' + 'X'.repeat(40));
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Connected');
  await form(page);
  await page.getByRole('combobox', { name: 'Destination', exact: true }).selectOption('kyoto');
  await page.getByRole('button', { name: 'Build & save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved privately');
  await expect(page.getByRole('heading', { name: 'Kyoto, Japan' })).toBeVisible();
  await page.getByRole('button', { name: 'Save trip', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('saved privately');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-');
  await page.getByRole('button', { name: 'Disconnect private planner' }).click();
  await expect(page.getByRole('heading', { name: 'Paris, France' })).toBeVisible();
});

test('rejects bad owner authentication and restores dialog focus', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Connect private planner', exact: true });
  await trigger.click();
  await page.getByLabel('Owner token').fill('wrong-' + 'X'.repeat(40));
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('authentication failed');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('exports Markdown and JSON without credentials', async ({ page }) => {
  for (const label of ['Download Markdown', 'Download JSON']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(/^travelbrain-paris\.(md|json)$/);
  }
});

test('escapes notes, reports low budget and excludes an activity', async ({ page }) => {
  await form(page);
  await page.getByLabel('Personal notes').fill('<img src=x onerror="window.injected=true">');
  await page.getByLabel('Trip budget').fill('50');
  await page.getByRole('button', { name: 'Build itinerary', exact: true }).click();
  await page.getByRole('tab', { name: 'Budget', exact: true }).click();
  await expect(page.getByText(/Over budget by/)).toBeVisible();
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(page.locator('.user-notes')).toContainText('<img');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.getByRole('tab', { name: 'Itinerary', exact: true }).click();
  const title = await page.locator('.activity h4').first().textContent();
  await page.getByRole('button', { name: `Exclude ${title}`, exact: true }).click();
  await expect(page.locator('.activity h4').filter({ hasText: title })).toHaveCount(0);
});

test('does not overflow at 320px and captures the rendered workspace', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => innerWidth)).toBe(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });
});
import { expect, test, type Page } from '@playwright/test';
import { TINY_PNG, campaignByTitle, deliveriesOf, freshWorkspace, readState, trackExternalRequests } from './helpers';

/** datetime-local value for now + minutes, in the browser's local time. */
async function localInputValue(page: Page, minutes: number): Promise<string> {
  return page.evaluate((m) => {
    const d = new Date(Date.now() + m * 60_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }, minutes);
}

async function generate(page: Page, topic = 'Create a post about lifeguard training for Lifeguard-Pro.org.') {
  await page.locator('#topic').fill(topic);
  await page.getByRole('button', { name: 'Generate Post' }).click();
  await expect(page.getByRole('heading', { name: 'Review your post' })).toBeVisible({ timeout: 6000 });
}

/** The campaign shown on Create Post (from the ?c= URL parameter). */
function currentCampaign(page: Page, state: any) {
  const id = new URL(page.url()).searchParams.get('c');
  return state.campaigns[id!];
}

const caption = (page: Page) => page.locator('textarea[id^="cap-"]').first();
const image = (page: Page) => page.locator('.post-media img').first();

test('opens on Create Post with only two navigation items and three examples', async ({ page }) => {
  const external = trackExternalRequests(page);
  await freshWorkspace(page);
  await expect(page).toHaveTitle('Lifeguard-Pro.org — Social Studio');
  const nav = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
  await expect(nav).toHaveCount(2);
  await expect(nav.nth(0)).toHaveText(/Create Post/);
  await expect(nav.nth(1)).toHaveText(/My Posts/);
  await expect(page.getByText('Preview only — no real posts are published')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where do you want to post?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Facebook' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Instagram' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /My Posts/ }).click();
  for (const name of ['Needs approval 1', 'Scheduled 1', 'Posted 1']) await expect(page.getByRole('tab', { name })).toBeVisible();
  await expect(page.getByText('Drafts to create later')).toHaveCount(0);
  expect(external).toEqual([]);
});

test('two-minute walkthrough: generate, rewrite, change image, approve and post now', async ({ page }) => {
  const external = trackExternalRequests(page);
  await freshWorkspace(page);
  await generate(page);
  await expect(page.getByText('Changes apply to all selected platforms.')).toBeVisible();

  // Generating never posts anything.
  let state = await readState(page);
  const c = currentCampaign(page, state);
  expect(deliveriesOf(state, c.groupIds[0])).toHaveLength(0);

  const cap1 = await caption(page).inputValue();
  const img1 = await image(page).getAttribute('src');
  await page.getByRole('button', { name: 'Rewrite caption' }).click();
  await expect(caption(page)).not.toHaveValue(cap1);
  expect(await image(page).getAttribute('src')).toBe(img1);

  const cap2 = await caption(page).inputValue();
  await page.getByRole('button', { name: /Change image/ }).click();
  await page.getByRole('menuitem', { name: 'Generate another' }).click();
  await expect(image(page)).not.toHaveAttribute('src', img1!);
  await expect(caption(page)).toHaveValue(cap2);

  await page.getByRole('button', { name: 'Approve & Post' }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve & Post' });
  await expect(dialog.getByText('Facebook')).toBeVisible();
  await expect(dialog.getByText('Instagram')).toBeVisible();
  await dialog.getByRole('button', { name: 'Approve & Post Now' }).dblclick(); // double-click must not double-post
  await expect(page.getByText('Posted in preview.').first()).toBeVisible();

  state = await readState(page);
  const dels = deliveriesOf(state, c.groupIds[0]);
  expect(dels.filter((d) => d.status === 'published_preview')).toHaveLength(2);
  expect(dels).toHaveLength(2);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /My Posts/ }).click();
  await page.getByRole('tab', { name: /Posted/ }).click();
  await expect(page.getByText(/Posted in preview on/).first()).toBeVisible();
  expect(external).toEqual([]);
});

test('same post with YouTube adds a separate video version; different posts gives one card per platform', async ({ page }) => {
  await freshWorkspace(page);
  await page.getByRole('button', { name: 'YouTube' }).click();
  await generate(page);
  await expect(page.locator('.post-card-simple')).toHaveCount(2);
  await expect(page.getByText('YouTube needs a video, so we prepared a video version.')).toBeVisible();
  await expect(page.locator('.post-card-simple video')).toHaveCount(1);

  await page.getByRole('button', { name: 'Start a new post' }).click();
  await page.getByRole('radio', { name: /Different posts/ }).click();
  await page.getByRole('button', { name: 'LinkedIn' }).click();
  await generate(page, 'Create a post about team development.');
  await expect(page.locator('.post-card-simple')).toHaveCount(4); // Facebook, Instagram, LinkedIn, YouTube
  const captions = await page.locator('textarea[id^="cap-"]').evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
  expect(new Set(captions.slice(0, 3)).size).toBeGreaterThan(1);
});

test('uploads and caption edits survive refresh; invalid upload keeps the current image', async ({ page }) => {
  await freshWorkspace(page);
  await generate(page);
  await page.getByTestId('upload-input').setInputFiles({ name: 'pool.png', mimeType: 'image/png', buffer: TINY_PNG });
  await expect(image(page)).toHaveAttribute('src', /^blob:/);
  await page.getByTestId('upload-input').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.getByText(/could not be read as an image/)).toBeVisible();
  await expect(image(page)).toHaveAttribute('src', /^blob:/);

  await caption(page).fill('Edited by hand for the client demo. #LifeguardPro');
  await expect(page.getByText('Saved')).toBeVisible();
  await readState(page);
  await page.reload();
  await expect(image(page)).toHaveAttribute('src', /^blob:/);
  expect(await image(page).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(caption(page)).toHaveValue('Edited by hand for the client demo. #LifeguardPro');
});

test('scheduled posting: publishes at its time; editing requires approval again; cancel keeps content', async ({ page }) => {
  await page.clock.install();
  await freshWorkspace(page);
  await generate(page);

  // Approve & schedule 5 minutes ahead.
  await page.getByRole('button', { name: 'Approve & Post' }).click();
  let dialog = page.getByRole('dialog', { name: 'Approve & Post' });
  await dialog.getByRole('radio', { name: 'Schedule for later' }).click();
  await dialog.getByLabel('Posting time').fill(await localInputValue(page, 5));
  await dialog.getByRole('button', { name: 'Approve & Schedule' }).click();
  await expect(page.getByText('Approved and scheduled.')).toBeVisible();

  let state = await readState(page);
  const c = currentCampaign(page, state);
  const gid = c.groupIds[0];
  expect(deliveriesOf(state, gid).map((d) => d.status)).toEqual(['scheduled', 'scheduled']);

  // Edit while scheduled → back to Needs approval, nothing will post.
  await page.goto('/posts?tab=scheduled');
  const scheduledCards = page.locator('.post-card-simple');
  const n = await scheduledCards.count();
  expect(n).toBe(2); // seeded LinkedIn + ours
  await page.getByRole('button', { name: 'Edit' }).first().click();
  const edit = page.getByRole('dialog', { name: 'Edit post' });
  await edit.locator('textarea').fill('A changed caption that needs approval again.');
  await edit.locator('textarea').blur();
  await expect(edit.locator('.badge', { hasText: 'Needs approval' })).toBeVisible();
  await edit.getByRole('button', { name: 'Close dialog' }).click();
  state = await readState(page);
  const editedGroups = Object.values(state.groups).filter((g: any) => g.reviewState === 'in_review') as any[];
  expect(editedGroups.length).toBeGreaterThan(0);

  // Re-approve our post for +5 min, then let the clock reach it: posts exactly once.
  await page.getByRole('tab', { name: /Needs approval/ }).click();
  const target = page.locator('.post-card-simple').filter({ has: page.locator('textarea', { hasText: 'A changed caption' }) }).first();
  await target.getByRole('button', { name: 'Approve & Post' }).click();
  dialog = page.getByRole('dialog', { name: 'Approve & Post' });
  await dialog.getByRole('radio', { name: 'Schedule for later' }).click();
  await dialog.getByLabel('Posting time').fill(await localInputValue(page, 5));
  await dialog.getByRole('button', { name: 'Approve & Schedule' }).click();
  await expect(page.getByText('Approved and scheduled.')).toBeVisible();
  await readState(page);
  await page.clock.fastForward('06:00');
  await page.waitForTimeout(2000);
  state = await readState(page);
  const all = Object.values(state.deliveries) as any[];
  const edited = all.filter((d) => state.revisions[d.revisionId]?.caption === 'A changed caption that needs approval again.');
  expect(edited.filter((d) => d.status === 'published_preview')).toHaveLength(edited.length);
  expect(edited.length).toBeGreaterThan(0);
  // The pre-edit scheduled sends were cancelled, never posted.
  expect(deliveriesOf(state, edited[0].groupId).filter((d) => d.status === 'cancelled').length).toBeGreaterThan(0);

  // Cancel the seeded scheduled post: content kept under Needs approval.
  await page.goto('/posts?tab=scheduled');
  await page.getByRole('button', { name: 'Cancel schedule' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel schedule' }).click();
  await expect(page.getByRole('tab', { name: 'Scheduled 0' })).toBeVisible();
  await page.getByRole('tab', { name: /Needs approval/ }).click();
  await expect(page.locator('textarea', { hasText: /team/i }).first()).toBeVisible();
});

test('Create later makes an unapproved draft at its time', async ({ page }) => {
  await page.clock.install();
  await freshWorkspace(page);
  await page.locator('#topic').fill('Create a post about preparing for the summer season.');
  await page.getByRole('button', { name: 'Create later' }).click();
  const dialog = page.getByRole('dialog', { name: 'When should we create your draft?' });
  await expect(dialog.getByText('You will review it before it is posted.')).toBeVisible();
  await dialog.getByLabel('Create the draft on').fill(await localInputValue(page, 5));
  await dialog.getByRole('button', { name: 'Create draft later' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /My Posts/ }).click();
  await expect(page.getByRole('heading', { name: 'Drafts to create later' })).toBeVisible();
  await expect(page.getByText('Preparing for the summer season')).toBeVisible();
  await readState(page);
  await page.clock.fastForward('06:00');
  await expect(page.getByRole('heading', { name: 'Drafts to create later' })).toHaveCount(0, { timeout: 5000 });
  await expect(page.getByRole('tab', { name: 'Needs approval 2' })).toBeVisible();
  const state = await readState(page);
  const c = campaignByTitle(state, 'Preparing for the summer season');
  expect(c).toBeTruthy();
  expect(deliveriesOf(state, c.groupIds[0])).toHaveLength(0);
});

test('after the preview was closed, overdue work waits for the user', async ({ page }) => {
  await freshWorkspace(page);
  await page.locator('#topic').fill('Create a post about pool safety checks.');
  await page.getByRole('button', { name: 'Create later' }).click();
  const dialog = page.getByRole('dialog', { name: 'When should we create your draft?' });
  await dialog.getByLabel('Create the draft on').fill(await localInputValue(page, 60));
  await dialog.getByRole('button', { name: 'Create draft later' }).click();
  await readState(page);
  // Simulate two days passing while closed.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('lgp-social-studio');
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite');
          const store = tx.objectStore('kv');
          const g = store.get('state:v1');
          g.onsuccess = () => {
            const s = g.result;
            s.preview.clockOffsetMs += 2 * 86_400_000;
            store.put(s, 'state:v1');
          };
          tx.oncomplete = () => resolve();
        };
      }),
  );
  await page.goto('/posts');
  await expect(page.getByText(/passed while this preview was closed/).first()).toBeVisible();
  let state = await readState(page);
  expect(Object.values(state.deliveries).filter((d: any) => d.status === 'published_preview')).toHaveLength(2); // only the seeded posted example
  await page.getByRole('button', { name: 'Create draft now' }).click();
  await expect(page.getByRole('heading', { name: 'Drafts to create later' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Scheduled/ }).click();
  await expect(page.getByRole('button', { name: 'Review posting time' })).toBeVisible();
  state = await readState(page);
  expect(campaignByTitle(state, 'Pool safety checks')).toBeTruthy();
});

test('readable at 390px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshWorkspace(page);
  await generate(page);
  for (const path of ['/', '/posts', '/posts?tab=scheduled', '/posts?tab=posted']) {
    await page.goto(path);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

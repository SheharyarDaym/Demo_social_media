import { expect, type Page } from '@playwright/test';

/** 1×1 PNG used as an "uploaded" image. */
export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Read the persisted app state straight from this app's IndexedDB (after the debounced save). */
export async function readState(page: Page): Promise<any> {
  await page.waitForTimeout(700);
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('lgp-social-studio');
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readonly');
          const g = tx.objectStore('kv').get('state:v1');
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function freshWorkspace(page: Page) {
  await page.goto('/');
  await page.evaluate(() => new Promise<void>((res) => {
    const r = indexedDB.deleteDatabase('lgp-social-studio');
    r.onsuccess = r.onerror = r.onblocked = () => res();
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create a post' })).toBeVisible();
}

export function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost') && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  return external;
}

export function campaignByTitle(state: any, title: string) {
  return Object.values(state.campaigns).find((c: any) => c.title === title) as any;
}

export function deliveriesOf(state: any, groupId: string) {
  return Object.values(state.deliveries).filter((d: any) => d.groupId === groupId) as any[];
}

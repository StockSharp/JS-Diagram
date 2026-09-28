import { expect, test, type Page } from '@playwright/test';

// A generic document drawn on a content page: a picture among text, which must not take the page's
// scrolling away and must follow the page's own colour tokens.

interface FixtureWindow {
    fixtureReady?: boolean;
    fixtureHandle: {
        diagram: {
            getViewState(): { zoom: number };
            getNodeBounds(id: string): { x: number; y: number; width: number; height: number } | null;
            worldToView(x: number, y: number): { x: number; y: number };
        };
    };
}

async function open(page: Page): Promise<void> {
    await page.goto('/tests/browser/fixtures/document.html');
    await page.waitForFunction(() => (window as unknown as FixtureWindow).fixtureReady === true);
    await expect(page.locator('#direct canvas')).toHaveCount(1);
}

function zoom(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as FixtureWindow).fixtureHandle.diagram.getViewState().zoom);
}

/** The canvas pixel just inside the gateway node's top-left corner, as [r, g, b]. */
function nodePixel(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const diagram = (window as unknown as FixtureWindow).fixtureHandle.diagram;
        const bounds = diagram.getNodeBounds('gate')!;
        const point = diagram.worldToView(bounds.x + 10, bounds.y + 5);
        const canvas = document.querySelector<HTMLCanvasElement>('#direct canvas')!;
        const ratio = canvas.width / canvas.clientWidth;
        const data = canvas.getContext('2d')!.getImageData(Math.round(point.x * ratio), Math.round(point.y * ratio), 1, 1).data;
        return [data[0], data[1], data[2]];
    });
}

test('a plain wheel over a document scrolls the page, Ctrl+wheel zooms the diagram', async ({ page }) => {
    await open(page);
    const canvas = page.locator('#direct canvas');
    const box = (await canvas.boundingBox())!;
    const before = await zoom(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await zoom(page)).toBe(before);

    const scrolled = await page.evaluate(() => window.scrollY);
    const moved = (await canvas.boundingBox())!;
    await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect.poll(() => zoom(page)).not.toBe(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test('a document canvas leaves vertical touch panning to the browser', async ({ page }) => {
    await open(page);

    for (const selector of ['#direct canvas', '#discovered canvas']) {
        expect(await page.locator(selector).evaluate((element) => getComputedStyle(element).touchAction)).toBe('pan-y');
    }
});

test('renderAll draws a host marked as a document without asking for the strategy palette', async ({ page }) => {
    const palette: string[] = [];
    page.on('request', (request) => { if (request.url().includes('designer-palette')) palette.push(request.url()); });

    await open(page);

    await expect(page.locator('#discovered canvas')).toHaveCount(1);
    await expect(page.locator('#discovered')).toHaveAttribute('data-rendered', '1');
    await expect(page.locator('#discovered')).not.toHaveClass(/ss-diagram-error/);
    expect(palette).toEqual([]);
});

test('a node coloured with a page token follows the page theme', async ({ page }) => {
    await open(page);

    // #c0392b under the dark theme; the entrance animation fades in, so wait for it to settle.
    await expect.poll(() => nodePixel(page), { timeout: 5_000 }).toEqual([192, 57, 43]);

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

    // #2e86de under the light one: the theme switch repaints, and the repaint re-reads the token.
    await expect.poll(() => nodePixel(page), { timeout: 5_000 }).toEqual([46, 134, 222]);
});

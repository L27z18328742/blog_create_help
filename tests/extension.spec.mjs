import { test as base, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const article = await readFile(new URL('./fixtures/article.html', import.meta.url), 'utf8');
const chinese = new Map([
  ['Context-aware caching', '结合上下文的缓存'],
  ['A cache stores the result of an expensive computation. Reusing it avoids repeating the same work.', '缓存保存开销较大的计算结果。复用它可以避免重复工作。'],
  ['Use a stable key', '使用稳定的键'],
  ['Use', '使用'],
  ['to retrieve the result. Read the', '来获取结果。阅读'],
  ['documentation', '文档'],
  ['for more details.', '了解更多细节。'],
  ['Compute the key.', '计算键。'],
  ['Include the input version.', '包含输入版本。'],
  ['Store the result.', '存储结果。'],
  ['The cache connects the two steps.', '缓存连接这两个步骤。'],
  ['Invalidation', '失效处理'],
  ['Invalidate the cache when the input changes. The next request will compute a fresh result.', '输入变化时使缓存失效。下一个请求将重新计算结果。'],
]);

const test = base.extend({
  app: async ({}, use) => {
    const requests = [];
    const controls = { response: 'complete', delay: 0, html: article };
    const server = createServer(async (req, res) => {
      if (req.url === '/v1/chat/completions') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const request = JSON.parse(body);
        requests.push({ body: request, headers: req.headers });
        const segments = JSON.parse(request.messages[1].content).segments;
        if (controls.delay) await new Promise(resolve => setTimeout(resolve, controls.delay));
        if (controls.response === 'http-error') { res.writeHead(429).end(); return; }
        let translations = segments.filter(item => item.translate).map(item => ({ id: item.id, text: chinese.get(item.text.trim()) ?? '中文译文' }));
        if (controls.response === 'incomplete') translations.pop();
        if (controls.response === 'duplicate') translations[1] = translations[0];
        if (controls.response === 'html') translations[0].text = '<img src=x onerror="window.injected=true">中文';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const content = controls.response === 'invalid-json' ? 'not JSON' : JSON.stringify({ translations });
        // Split between bytes (including inside Chinese characters), like a real stream.
        const events = [
          { choices: [{ delta: { reasoning_content: 'Private reasoning must not appear in the page.' }, finish_reason: null }] },
          { choices: [{ delta: { content }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: controls.response === 'truncated' ? 'length' : 'stop' }] },
        ];
        const bytes = Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join('') +
          (controls.response === 'disconnected' ? '' : 'data: [DONE]\r\n\r\n'));
        for (let offset = 0; offset < bytes.length; offset += 31) res.write(bytes.subarray(offset, offset + 31));
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(controls.html);
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const temporary = await mkdtemp(join(tmpdir(), 'blog-translator-test-'));
    const extension = join(temporary, 'extension');
    await cp(resolve('dist'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
    // Browser automation cannot press the toolbar to grant activeTab. Grant only the
    // local fixture origin in this temporary test build. Production manifest is untouched.
    manifest.host_permissions = ['http://127.0.0.1/*'];
    if (process.env.RUN_LIVE_API_TEST === '1') manifest.host_permissions.push('https://api.xiaomimimo.com/*');
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).host;
      const options = await context.newPage();
      await options.goto(`chrome-extension://${id}/options.html`);
      await options.getByLabel('API 地址').fill(`${origin}/v1`);
      await options.getByLabel('模型名称').fill('fixture-model');
      await options.getByLabel('API 密钥').fill('local-test-key');
      await options.getByRole('button', { name: '保存设置' }).click();
      await expect(options.getByRole('status')).toContainText('设置已保存');
      await options.close();
      const page = await context.newPage();
      await page.goto(origin);
      const openPopup = async () => {
        const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), page.url());
        const popup = await context.newPage();
        // Playwright does not expose Chrome's toolbar popup as a Page. Load the
        // actual popup document in a tab and adapt only its active-tab lookup.
        await popup.addInitScript(tab => { chrome.tabs.query = async () => [tab]; }, tab);
        await popup.goto(`chrome-extension://${id}/popup.html`);
        return popup;
      };
      await use({ page, worker, context, id, requests, controls, origin, openPopup });
    } finally {
      await context.close();
      await new Promise(resolve => server.close(resolve));
      await rm(temporary, { recursive: true, force: true });
    }
  },
});

test('user translates the complete article, preserves structure and behavior, and switches without another request', async ({ app }) => {
  const { page, requests, openPopup } = app;
  const original = await page.locator('article').innerHTML();
  await page.locator('a').evaluate(link => link.addEventListener('click', event => {
    event.preventDefault(); link.setAttribute('data-clicked', 'yes');
  }));
  const structure = () => page.locator('article').evaluate(root => [...root.querySelectorAll('*')].map(element => [element.tagName, [...element.attributes].map(attr => [attr.name, attr.value])]));
  const before = await structure();
  const popup = await openPopup();
  await expect(popup.getByRole('button', { name: '翻译全文', exact: true })).toBeEnabled();
  expect(requests).toHaveLength(0);
  await popup.getByRole('button', { name: '翻译全文', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('全文翻译完成');
  for (const translation of chinese.values()) await expect(page.locator('article')).toContainText(translation);
  expect(await structure()).toEqual(before);
  await expect(page.locator('pre')).toHaveText('const cacheKey = "article:v1";\ncache.set(cacheKey, result);');
  await expect(page.locator('p code')).toHaveText('cacheKey');
  await expect(page.locator('nav')).toHaveText('Navigation stays in English');
  await expect(page.locator('#comments')).toHaveText('Comments stay in English');
  await expect(page.locator('.ad')).toHaveText('Advertisement stays in English');
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.cookie).toBeUndefined();
  expect(requests[0].headers.authorization).toBe('Bearer local-test-key');
  const sent = requests[0].body.messages[1].content;
  expect(sent).toContain('cacheKey');
  expect(sent).not.toMatch(/Navigation|Comments|Advertisement|Hidden content/);
  await popup.getByRole('button', { name: '切回原文' }).click();
  await expect(page.locator('article')).toHaveJSProperty('innerHTML', original);
  await popup.getByRole('button', { name: '显示中文' }).click();
  await expect(page.locator('h1')).toHaveText('结合上下文的缓存');
  expect(requests).toHaveLength(1);
  await page.getByRole('link', { name: '文档' }).click();
  await expect(page.locator('a')).toHaveAttribute('data-clicked', 'yes');
});

for (const response of ['http-error', 'incomplete', 'duplicate', 'invalid-json', 'truncated', 'disconnected']) {
  test(`${response}: shows an error and leaves the full original article intact`, async ({ app }) => {
    const original = await app.page.locator('article').innerHTML();
    app.controls.response = response;
    const popup = await app.openPopup();
    await popup.getByRole('button', { name: '翻译全文', exact: true }).click();
    await expect(popup.getByRole('button', { name: '重试全文翻译' })).toBeEnabled();
    await expect(app.page.locator('article')).toHaveJSProperty('innerHTML', original);
    expect(app.requests).toHaveLength(1);
    app.controls.response = 'complete';
    await popup.getByRole('button', { name: '重试全文翻译' }).click();
    await expect(app.page.locator('h1')).toHaveText('结合上下文的缓存');
    expect(app.requests).toHaveLength(2);
  });
}

test('reopening the popup while translating retains progress and sends only one request', async ({ app }) => {
  app.controls.delay = 1500;
  let popup = await app.openPopup();
  await popup.getByRole('button', { name: '翻译全文', exact: true }).click();
  await expect(popup.getByRole('button', { name: '翻译中…' })).toBeDisabled();
  await popup.close();
  popup = await app.openPopup();
  await expect(popup.getByRole('status')).toContainText('全文翻译完成');
  expect(app.requests).toHaveLength(1);
});

test('page changes during the request do not receive stale translations', async ({ app }) => {
  app.controls.delay = 800;
  const popup = await app.openPopup();
  await popup.getByRole('button', { name: '翻译全文', exact: true }).click();
  await expect.poll(() => app.requests.length).toBe(1);
  await app.page.locator('h1').evaluate(element => { element.textContent = 'A newly loaded article'; });
  await expect(popup.getByRole('status')).toContainText('正文在翻译期间发生变化');
  await expect(app.page.locator('h1')).toHaveText('A newly loaded article');
  await expect(app.page.locator('h2')).toHaveText('Use a stable key');
});

for (const [label, html, error] of [
  ['ambiguous article', `${article}<article><p>A second article.</p></article>`, '无法可靠识别'],
  ['missing article', '<html><body><p>Some text without an article container.</p></body></html>', '无法可靠识别'],
  ['oversized article', `<html><body><article><p>${'Long article content. '.repeat(2100)}</p></article></body></html>`, '40,000'],
]) {
  test(`${label}: fails clearly without a paid request`, async ({ app }) => {
    app.controls.html = html;
    await app.page.reload();
    const original = await app.page.locator('body').innerHTML();
    const popup = await app.openPopup();
    await popup.getByRole('button', { name: '翻译全文', exact: true }).click();
    await expect(popup.getByRole('status')).toContainText(error);
    await expect(app.page.locator('body')).toHaveJSProperty('innerHTML', original);
    expect(app.requests).toHaveLength(0);
  });
}

test('HTML in a model response is displayed as text and cannot create elements', async ({ app }) => {
  app.controls.response = 'html';
  const popup = await app.openPopup();
  await popup.getByRole('button', { name: '翻译全文', exact: true }).click();
  await expect(app.page.locator('h1')).toHaveText('<img src=x onerror="window.injected=true">中文');
  await expect(app.page.locator('h1 img')).toHaveCount(0);
  expect(await app.page.evaluate(() => window.injected)).toBeUndefined();
});

test('clearing the key prevents subsequent requests', async ({ app }) => {
  const options = await app.context.newPage();
  await options.goto(`chrome-extension://${app.id}/options.html`);
  await options.getByRole('button', { name: '清除密钥' }).click();
  await expect(options.getByRole('status')).toHaveText('密钥已清除。');
  await options.close();
  const popup = await app.openPopup();
  await popup.getByRole('button', { name: '翻译全文', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('请先在服务设置');
  expect(app.requests).toHaveLength(0);
});

test('LIVE MiMo: translates the original fixture through the installed extension and restores it', async ({ app }, testInfo) => {
  test.skip(process.env.RUN_LIVE_API_TEST !== '1', 'Explicit opt-in required for a paid API request');
  test.setTimeout(150_000);
  const options = await app.context.newPage();
  await options.goto(`chrome-extension://${app.id}/options.html`);
  await options.getByLabel('API 地址').fill(process.env.MIMO_BASE_URL);
  await options.getByLabel('模型名称').fill(process.env.MIMO_MODEL);
  // Read in page.evaluate so failed assertions/traces never contain the secret value.
  await options.locator('#apiKey').evaluate((input, key) => { input.value = key; }, process.env.MIMO_API_KEY);
  await options.getByRole('button', { name: '保存设置' }).click();
  await expect(options.getByRole('status')).toContainText('设置已保存');
  await options.close();
  const original = await app.page.locator('article').innerHTML();
  const code = await app.page.locator('pre').textContent();
  let calls = 0;
  app.context.on('request', request => { if (request.url() === 'https://api.xiaomimimo.com/v1/chat/completions') calls++; });
  const popup = await app.openPopup();
  await popup.getByRole('button', { name: '翻译全文', exact: true }).click();
  await expect(popup.getByRole('status')).toContainText('全文翻译完成', { timeout: 125_000 });
  await expect(app.page.locator('h1')).toContainText(/[\u3400-\u9fff]/);
  for (const element of await app.page.locator('article > p:not([hidden]), h2, h3, figcaption').all()) {
    await expect(element).toContainText(/[\u3400-\u9fff]/);
  }
  await expect(app.page.locator('pre')).toHaveText(code);
  await expect(app.page.locator('p code')).toHaveText('cacheKey');
  await app.page.screenshot({ path: testInfo.outputPath('translated.png'), fullPage: true });
  await writeFile(testInfo.outputPath('translated-text.txt'), await app.page.locator('article').innerText());
  await popup.getByRole('button', { name: '切回原文' }).click();
  await expect(app.page.locator('article')).toHaveJSProperty('innerHTML', original);
  await popup.getByRole('button', { name: '显示中文' }).click();
  expect(calls).toBe(1);
});

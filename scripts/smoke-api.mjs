import assert from 'node:assert/strict';

const { MIMO_API_KEY, MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1', MIMO_MODEL = 'mimo-v2.5-pro' } = process.env;
assert(MIMO_API_KEY, 'Set MIMO_API_KEY or run with --env-file=.env.local');
const base = new URL(MIMO_BASE_URL);
assert.equal(base.origin, 'https://api.xiaomimimo.com', 'This smoke test only sends credentials to the official MiMo API');
const headers = { Authorization: `Bearer ${MIMO_API_KEY}`, 'Content-Type': 'application/json' };
const start = Date.now();
const models = await fetch(`${base.href.replace(/\/$/, '')}/models`, {
  headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
});
assert.equal(models.status, 200, `Model listing failed: HTTP ${models.status}`);
const available = (await models.json()).data.map(item => item.id);
console.log('Available models:', available.join(', '));
assert(available.includes(MIMO_MODEL), 'Configured model is not available');
const response = await fetch(`${base.href.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(90_000),
  body: JSON.stringify({
    model: MIMO_MODEL, stream: true, response_format: { type: 'json_object' },
    thinking: { type: 'disabled' }, max_completion_tokens: 1024,
    messages: [
      { role: 'system', content: 'Translate the supplied original English article to Simplified Chinese, preserving meaning and consistent terminology. Segments with the same block belong to one paragraph. Use ALL segments as context. Return JSON only: {"translations":[{"id":0,"text":"中文"}]}. Return each translate=true segment exactly once. Do not return translate=false segments, which are protected code.' },
      { role: 'user', content: JSON.stringify([
        { id: 0, block: 0, translate: true, text: 'A cache stores the result of an expensive computation.' },
        { id: 1, block: 1, translate: true, text: 'Use ' },
        { id: 2, block: 1, translate: false, text: 'cacheKey' },
        { id: 3, block: 1, translate: true, text: ' to retrieve that result without repeating the computation.' },
      ]) },
    ],
  }),
});
assert.equal(response.status, 200, `Translation failed: HTTP ${response.status}`);
let content = '';
let finish = '';
let usage;
const stream = await response.text();
for (const line of stream.split('\n')) {
  if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
  const event = JSON.parse(line.slice(5));
  content += event.choices?.[0]?.delta?.content ?? '';
  finish = event.choices?.[0]?.finish_reason ?? finish;
  if (event.usage) usage = event.usage;
}
assert(stream.includes('[DONE]'), 'Stream did not complete');
assert.equal(finish, 'stop');
const { translations } = JSON.parse(content);
console.log(JSON.stringify({ model: MIMO_MODEL, elapsedMs: Date.now() - start, usage, translations }, null, 2));
assert.equal(translations.length, 3);
assert.deepEqual(translations.map(item => item.id), [0, 1, 3]);
assert(translations.every(item => /[\u3400-\u9fff]/u.test(item.text)));
console.log('PASS: streaming JSON, complete translation, and protected code excluded from output.');

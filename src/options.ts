import { errorMessage, validateSettings } from './protocol';

const form = document.querySelector<HTMLFormElement>('#settings')!;
const endpoint = document.querySelector<HTMLInputElement>('#endpoint')!;
const model = document.querySelector<HTMLInputElement>('#model')!;
const apiKey = document.querySelector<HTMLInputElement>('#apiKey')!;
const status = document.querySelector<HTMLElement>('#status')!;

async function load() {
  const [config, secret] = await Promise.all([
    chrome.storage.local.get(['endpoint', 'model']), chrome.storage.session.get('apiKey'),
  ]);
  endpoint.value = typeof config.endpoint === 'string' ? config.endpoint : 'https://api.xiaomimimo.com/v1';
  model.value = typeof config.model === 'string' ? config.model : 'mimo-v2.5-pro';
  apiKey.value = typeof secret.apiKey === 'string' ? secret.apiKey : '';
}
void load().catch(error => { status.textContent = errorMessage(error); });

form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const settings = validateSettings({ endpoint: endpoint.value, model: model.value, apiKey: apiKey.value });
    // Request within the submit gesture, before other asynchronous work.
    const granted = await chrome.permissions.request({ origins: [new URL(settings.endpoint).origin + '/*'] });
    if (!granted) throw new Error('未获得服务域名权限，设置未保存。');
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.local.set({ endpoint: settings.endpoint, model: settings.model });
    await chrome.storage.session.set({ apiKey: settings.apiKey });
    status.textContent = '设置已保存。返回博客，点击扩展中的“翻译全文”。';
  } catch (error) {
    status.textContent = errorMessage(error);
  }
});

document.querySelector('#clear')!.addEventListener('click', async () => {
  try {
    await chrome.storage.session.remove('apiKey');
    apiKey.value = '';
    status.textContent = '密钥已清除。';
  } catch (error) { status.textContent = errorMessage(error); }
});

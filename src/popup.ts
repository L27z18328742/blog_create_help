import { errorMessage, type SessionStatus } from './protocol';

const status = document.querySelector<HTMLElement>('#status')!;
const translate = document.querySelector<HTMLButtonElement>('#translate')!;
const toggle = document.querySelector<HTMLButtonElement>('#toggle')!;
let tabId: number;
let timer: ReturnType<typeof setInterval> | undefined;

function render(state: SessionStatus) {
  status.textContent = state.message;
  translate.disabled = !['ready', 'error'].includes(state.phase);
  translate.textContent = state.phase === 'loading' ? '翻译中…' : state.phase === 'error' ? '重试全文翻译' : '翻译全文';
  toggle.hidden = !['translated', 'original'].includes(state.phase);
  toggle.textContent = state.phase === 'original' ? '显示中文' : '切回原文';
}

function failed(error: unknown) {
  clearInterval(timer);
  status.textContent = `无法操作此页面：${errorMessage(error)} 请在普通博客网页重新打开扩展。`;
  translate.disabled = true;
  toggle.hidden = true;
}

async function send(type: string) {
  render(await chrome.tabs.sendMessage(tabId, { type }));
}

async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error('请打开 HTTP 或 HTTPS 博客网页。');
  }
  tabId = tab.id;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await send('session-status');
  timer = setInterval(() => { void send('session-status').catch(failed); }, 500);
}

translate.addEventListener('click', () => {
  translate.disabled = true;
  void send('session-start').catch(failed);
});
toggle.addEventListener('click', () => { void send('session-toggle').catch(failed); });
document.querySelector('#settings')!.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
window.addEventListener('unload', () => clearInterval(timer));
void initialize().catch(failed);

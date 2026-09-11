import { errorMessage, validateSegments, validateTranslations, type Segment, type SessionStatus } from './protocol';

// Script injection may happen every time the popup opens. Keep one session per document.
const scope = globalThis as typeof globalThis & { blogTranslatorInstalled?: boolean };
if (!scope.blogTranslatorInstalled) {
  scope.blogTranslatorInstalled = true;
  installSession();
}

function installSession() {
  let status: SessionStatus = { phase: 'ready', message: '点击翻译全文后开始处理。' };
  let snapshot: ReturnType<typeof extractArticle> | undefined;
  let translated = new Map<number, string>();

  function unchanged(mode: 'original' | 'translated'): boolean {
    return !!snapshot && location.href === snapshot.url && snapshot.root.isConnected &&
      snapshot.entries.every(entry => entry.node.isConnected && snapshot!.root.contains(entry.node) &&
        entry.node.nodeValue === (mode === 'translated' && translated.has(entry.id)
          ? translated.get(entry.id) : entry.text)) &&
      (() => {
        const current = extractTextNodes(snapshot!.root);
        return current.length === snapshot!.entries.length && current.every((node, index) => node === snapshot!.entries[index]!.node);
      })();
  }

  function restoreKnownTranslations() {
    if (!snapshot) return;
    for (const entry of snapshot.entries) {
      if (entry.node.nodeValue === translated.get(entry.id)) entry.node.nodeValue = entry.text;
    }
  }

  async function translate() {
    if (status.phase === 'loading' || status.phase === 'translated' || status.phase === 'original') return;
    status = { phase: 'loading', message: '正在结合全文上下文翻译，请稍候…' };
    try {
      snapshot = extractArticle();
      const segments = validateSegments(snapshot.entries.map(({ node: _node, ...segment }) => segment));
      const response = await chrome.runtime.sendMessage({ type: 'translate-article', segments });
      if (!response?.ok) throw new Error(response?.error || '翻译服务未返回结果，请主动重试。');
      const result = validateTranslations({ translations: response.translations }, segments);
      if (!unchanged('original')) throw new Error('正文在翻译期间发生变化，未应用译文。请重新翻译。');
      translated = new Map(result.map(item => {
        const source = snapshot!.entries.find(entry => entry.id === item.id)!.text;
        return [item.id, (source.match(/^\s*/)?.[0] ?? '') + item.text.trim() + (source.match(/\s*$/)?.[0] ?? '')];
      }));
      for (const entry of snapshot.entries) {
        if (translated.has(entry.id)) entry.node.nodeValue = translated.get(entry.id)!;
      }
      status = { phase: 'translated', message: '全文翻译完成。可随时切回原文。' };
    } catch (error) {
      status = { phase: 'error', message: errorMessage(error) };
      snapshot = undefined;
      translated.clear();
    }
  }

  function toggle() {
    if (status.phase !== 'translated' && status.phase !== 'original') return;
    if (!unchanged(status.phase)) {
      restoreKnownTranslations();
      snapshot = undefined;
      translated.clear();
      status = { phase: 'error', message: '正文已变化，已恢复仍可恢复的原文。请重新翻译。' };
      return;
    }
    const showOriginal = status.phase === 'translated';
    for (const entry of snapshot!.entries) {
      entry.node.nodeValue = showOriginal ? entry.text : translated.get(entry.id) ?? entry.text;
    }
    status = showOriginal
      ? { phase: 'original', message: '正在阅读原文，已有译文可直接切换。' }
      : { phase: 'translated', message: '正在阅读中文译文。' };
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'session-status') respond(status);
    if (message?.type === 'session-start') {
      void translate();
      respond(status);
    }
    if (message?.type === 'session-toggle') {
      toggle();
      respond(status);
    }
  });
}

const excluded = 'nav,aside,footer,script,style,noscript,template,button,input,textarea,select,' +
  'iframe,svg,math,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],' +
  '[role="navigation"],[role="complementary"],.comments,#comments,.comment,.advertisement,.ads,.ad,[data-ad]';

function extractTextNodes(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.nodeValue?.trim() || !parent || parent.closest(excluded)) continue;
    let visible = true;
    for (let element: Element | null = parent; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        visible = false;
        break;
      }
    }
    if (visible) nodes.push(node as Text);
  }
  return nodes;
}

function extractArticle() {
  const candidates = [...document.querySelectorAll('article,[itemprop="articleBody"]')]
    .filter(element => !element.closest(excluded));
  const outer = candidates.filter(element => !candidates.some(other => other !== element && other.contains(element)));
  const fallback = [...document.querySelectorAll('main,[role="main"]')];
  const roots = outer.length ? outer : fallback;
  const root = roots[0];
  if (roots.length !== 1 || !root || !root.querySelector('p')) {
    throw new Error('无法可靠识别唯一文章正文。第一版支持具有 article 或 main 标记的博客。');
  }
  const nodes = extractTextNodes(root);
  const blocks = new Map<Element, number>();
  const entries = nodes.map((node, id) => {
    const parent = node.parentElement!;
    const block = parent.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,pre') ?? root;
    if (!blocks.has(block)) blocks.set(block, blocks.size);
    return {
      id, block: blocks.get(block)!, node, text: node.nodeValue!,
      translate: !parent.closest('pre,code,kbd,samp,[translate="no"],.notranslate'),
    } satisfies Segment & { node: Text };
  });
  if (entries.filter(entry => entry.translate).reduce((total, entry) => total + entry.text.trim().length, 0) < 80) {
    throw new Error('可识别的正文过短，未发送翻译。');
  }
  return { root, entries, url: location.href };
}

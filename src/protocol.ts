export const MAX_ARTICLE_CHARS = 40_000;
export const MAX_SEGMENTS = 2_000;

export interface Segment {
  id: number;
  block: number;
  text: string;
  translate: boolean;
}

export interface Translation {
  id: number;
  text: string;
}

export interface Settings {
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface SessionStatus {
  phase: 'ready' | 'loading' | 'translated' | 'original' | 'error';
  message: string;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试。';
}

export function validateSettings(value: unknown): Settings {
  const settings = value as Partial<Settings> | null;
  if (!settings || typeof settings.endpoint !== 'string' ||
      typeof settings.model !== 'string' || typeof settings.apiKey !== 'string' ||
      !settings.model.trim() || !settings.apiKey.trim()) {
    throw new Error('请先在服务设置中填写 API 地址、模型和密钥。');
  }
  let url: URL;
  try { url = new URL(settings.endpoint.trim()); }
  catch { throw new Error('API 地址无效。'); }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('请使用不含凭证、查询参数或片段的 HTTPS API 地址（本机服务可用 HTTP）。');
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) url.pathname = `${path}/chat/completions`;
  return { endpoint: url.href, model: settings.model.trim(), apiKey: settings.apiKey.trim() };
}

export function validateSegments(value: unknown): Segment[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_SEGMENTS) {
    throw new Error('正文为空或分段过多，未发送翻译。');
  }
  let length = 0;
  const ids = new Set<number>();
  for (const segment of value) {
    if (!segment || !Number.isSafeInteger(segment.id) || ids.has(segment.id) ||
        !Number.isSafeInteger(segment.block) || typeof segment.text !== 'string' ||
        typeof segment.translate !== 'boolean') {
      throw new Error('正文数据无效。');
    }
    ids.add(segment.id);
    length += segment.text.length;
  }
  if (length > MAX_ARTICLE_CHARS) {
    throw new Error('文章超过第一版 40,000 字符上限，未发送翻译；不会只翻译部分正文。');
  }
  return value as Segment[];
}

export function validateTranslations(value: unknown, segments: Segment[]): Translation[] {
  const result = value as { translations?: unknown } | null;
  const expected = new Set(segments.filter(s => s.translate).map(s => s.id));
  if (!result || !Array.isArray(result.translations) || result.translations.length !== expected.size) {
    throw new Error('译文不完整，已保留原文。请主动重试。');
  }
  for (const item of result.translations) {
    if (!item || !expected.delete(item.id) || typeof item.text !== 'string' || !item.text.trim()) {
      throw new Error('译文分段无效，已保留原文。请主动重试。');
    }
  }
  return result.translations as Translation[];
}

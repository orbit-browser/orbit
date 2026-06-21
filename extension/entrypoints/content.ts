import { Readability } from '@mozilla/readability';
import type { PageContent } from '../lib/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    function extract(): PageContent | null {
      try {
        const docClone = document.cloneNode(true) as Document;
        const article = new Readability(docClone).parse();
        if (!article) return null;
        const text = (article.textContent ?? '').trim();
        return {
          title: article.title || document.title,
          textContent: text.slice(0, 8000),
          excerpt: article.excerpt || text.slice(0, 200),
          byline: article.byline || undefined,
          siteName: article.siteName || undefined,
          length: article.length ?? text.length,
        };
      } catch {
        return null;
      }
    }

    // 페이지 로드 완료 시 background에 캐시
    function sendToBackground() {
      const content = extract();
      chrome.runtime.sendMessage({ type: 'PAGE_CONTENT_READY', content }).catch(() => {});
    }

    if (document.readyState === 'complete') {
      sendToBackground();
    } else {
      window.addEventListener('load', sendToBackground, { once: true });
    }

    // background의 온-디맨드 요청 처리
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'EXTRACT_CONTENT') return false;
      sendResponse(extract());
      return true;
    });
  },
});

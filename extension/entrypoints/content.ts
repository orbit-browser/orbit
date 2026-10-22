import { Readability } from '@mozilla/readability';
import { MAX_CONTENT_EXCERPT_LENGTH } from '../lib/events/types';
import { MIN_READABLE_LENGTH, pickPageText } from '../lib/page-text';
import { isSensitiveUrl } from '../lib/sensitive-domains';
import type { PageContent } from '../lib/types';

/** load 시점 본문이 짧으면 늦게 그려지는 본문을 기다렸다 한 번 더 추출한다. */
const RETRY_DELAY_MS = 3000;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    function parseArticle(doc: Document) {
      try {
        return new Readability(doc.cloneNode(true) as Document).parse();
      } catch {
        return null;
      }
    }

    // content script는 최상위 프레임에서만 돈다 — 본문이 same-origin iframe에 있는 페이지(네이버 블로그 #mainFrame)용.
    // 민감 판정은 바깥 페이지 URL로만 하므로, 결제·인증 같은 민감 경로의 iframe은 여기서 건너뛴다.
    function sameOriginFrameTexts(): string[] {
      const texts: string[] = [];
      for (const frame of document.querySelectorAll('iframe')) {
        const doc = frame.contentDocument; // cross-origin이면 null
        if (!doc?.body || isSensitiveUrl(doc.location.href)) continue;
        texts.push(parseArticle(doc)?.textContent ?? '');
      }
      return texts;
    }

    function extract(): PageContent | null {
      try {
        const article = parseArticle(document);
        const text = pickPageText(
          article?.textContent ?? '',
          sameOriginFrameTexts,
          () => document.body?.innerText ?? '',
        ).slice(0, MAX_CONTENT_EXCERPT_LENGTH);
        if (!text) return null;
        return {
          title: article?.title || document.title,
          textContent: text,
          excerpt: article?.excerpt || text.slice(0, 200),
          byline: article?.byline || undefined,
          siteName: article?.siteName || undefined,
          length: text.length,
        };
      } catch {
        return null;
      }
    }

    function send(content: PageContent | null) {
      chrome.runtime.sendMessage({ type: 'PAGE_CONTENT_READY', content }).catch(() => {});
    }

    // 페이지 로드 완료 시 background에 캐시. 짧으면 한 번 더 추출해 더 길 때만 다시 보낸다
    // (background는 열린 방문 이벤트의 본문을 덮어쓴다).
    function sendToBackground() {
      const content = extract();
      send(content);
      const sentLength = content?.textContent.length ?? 0;
      if (sentLength >= MIN_READABLE_LENGTH) return;

      const url = location.href;
      setTimeout(() => {
        if (location.href !== url) return; // SPA 이동 후 본문은 spa_nav 경로가 따로 가져간다
        const retry = extract();
        if ((retry?.textContent.length ?? 0) > sentLength) send(retry);
      }, RETRY_DELAY_MS);
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

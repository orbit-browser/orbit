import { describe, expect, it } from 'vitest';
import { isSensitiveUrl } from '../../lib/sensitive-domains';

describe('isSensitiveUrl', () => {
  it.each([
    'https://www.hometax.go.kr/websquare/refund',
    'https://example.com/login/step2',
    'https://example.com/account/password',
  ])('flags plain sensitive url %s', (url) => {
    expect(isSensitiveUrl(url)).toBe(true);
  });

  // 서버 event_filter.is_sensitive_url과 같은 우회 URL(tests/test_path_privacy.py).
  it.each([
    'https://www.hometax.go.kr./websquare/refund', // 끝 점 호스트
    'https://HOMETAX.GO.KR./x',
    'https://example.com/%6Cogin/step2', // 인코딩한 경로
    'https://example.com/%256Cogin/step2', // 이중 인코딩
    'https://example.com/%EF%BD%8Cogin/step2', // 전각 ｌ
    'https://example.com/ｌogin/step2', // 전각 문자 그대로
    'https://example.com/account/%EF%BD%90assword',
  ])('flags encoded or full-width bypass %s', (url) => {
    expect(isSensitiveUrl(url)).toBe(true);
  });

  it.each([
    'https://react.dev/learn/thinking-in-react',
    'https://example.com/blog/%ED%95%9C%EA%B8%80',
    'https://example.com/%E0%A4%A', // 깨진 인코딩은 오류 없이 판정한다
    'not a url',
  ])('keeps ordinary url %s', (url) => {
    expect(isSensitiveUrl(url)).toBe(false);
  });

  it('정부 개인 서비스는 민감, 공공 공지·안내 페이지는 수집 대상', () => {
    expect(isSensitiveUrl('https://www.gov.kr/portal/rcvfvrSvc/dtlEx/1')).toBe(true);
    expect(isSensitiveUrl('https://hometax.go.kr/websquare/websquare.html')).toBe(true);
    expect(isSensitiveUrl('https://ecfs.scourt.go.kr/ecf/index.jsp')).toBe(true);
    expect(isSensitiveUrl('https://www.bokjiro.go.kr/ssis-tbu/cms/pc/customer/notice/130')).toBe(false);
    expect(isSensitiveUrl('https://baro.gyeongnam.go.kr/baro/serviceView.es?service_no=452')).toBe(false);
  });

  it('로그인·결제 경로와 금융 도메인은 그대로 민감', () => {
    expect(isSensitiveUrl('https://www.bokjiro.go.kr/login')).toBe(true);
    expect(isSensitiveUrl('https://shop.example.com/checkout')).toBe(true);
    expect(isSensitiveUrl('https://www.kbstar.com/main')).toBe(true);
  });
});

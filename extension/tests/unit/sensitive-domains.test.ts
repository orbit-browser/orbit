import { describe, expect, it } from 'vitest';
import { isSensitiveUrl } from '../../lib/sensitive-domains';

describe('isSensitiveUrl', () => {
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

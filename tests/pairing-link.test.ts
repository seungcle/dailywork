import { describe, expect, it } from "vitest";
import { pairingLink, parsePairingHash } from "@/lib/format";
import { newPairingCode, normalizePairingCode } from "@/server/crypto";

describe("연결 QR 주소", () => {
  it("코드를 서버로 전송되지 않는 # 뒤에 넣는다", () => {
    const u = new URL(pairingLink("https://example.com", "7KQM-3XPA"));
    expect(u.pathname).toBe("/kiosk/setup");
    expect(u.search).toBe("");
    expect(u.hash).toBe("#code=7KQM-3XPA");
  });

  it("발급하는 코드는 항상 주소에서 다시 읽을 수 있다", () => {
    for (let i = 0; i < 200; i++) {
      const code = newPairingCode();
      expect(parsePairingHash(new URL(pairingLink("https://x.test", code)).hash)).toBe(code);
    }
  });

  it("읽은 코드는 서버가 쓰는 정규화 값과 같다", () => {
    const code = newPairingCode();
    expect(normalizePairingCode(parsePairingHash(`#code=${code}`)!)).toBe(normalizePairingCode(code));
  });

  it("소문자와 하이픈 없는 코드도 읽는다", () => {
    expect(parsePairingHash("#code=7kqm3xpa")).toBe("7KQM-3XPA");
  });

  it("형식이 맞지 않는 값은 무시한다", () => {
    for (const h of ["", "#", "#code=", "#code=SHORT", "#code=AAAA-BBBB-CCCC", "#code=0000-1111", "#other=7KQM-3XPA", "#code=<script>"]) {
      expect(parsePairingHash(h), h).toBeNull();
    }
  });
});

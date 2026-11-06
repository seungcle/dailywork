"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, QrCode } from "lucide-react";
import { api } from "@/lib/api";
import { parsePairingHash } from "@/lib/format";

export function KioskSetup() {
  const [code, setCode] = useState("");
  const [fromQr, setFromQr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // QR로 들어오면 코드를 채우고 주소창과 방문 기록에서 지운다.
  useEffect(() => {
    const scanned = parsePairingHash(window.location.hash);
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    if (scanned) setTimeout(() => { setCode(scanned); setFromQr(true); }, 0);
  }, []);

  // 코드는 한 번만 쓸 수 있어 버튼을 눌러야 소모한다. 다른 사람의 폰이 QR을 찍어도 열리기만 하고 연결되지 않는다.
  const connect = async () => {
    setBusy(true); setError(null);
    try {
      await api("/api/kiosk/setup", { body: { code } });
      window.location.replace("/kiosk");
    } catch (err) {
      setError((err as Error).message);
      setFromQr(false);
      setCode("");
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      {fromQr ? (
        <div className="w-full max-w-md rounded-xl bg-white p-8 text-center text-slate-900">
          <CheckCircle2 className="mx-auto mb-3 size-12 text-emerald-600" />
          <h1 className="text-2xl font-bold">QR을 확인했습니다</h1>
          <p className="mt-2 text-slate-600">이 기기를 출퇴근 키오스크로 연결합니다. 현장에 둘 태블릿이 맞는지 확인해 주세요.</p>
          <button type="button" disabled={busy} onClick={connect} className="mt-6 flex h-20 w-full items-center justify-center gap-2 rounded-lg bg-blue-900 text-2xl font-bold text-white disabled:opacity-40">
            {busy && <Loader2 className="size-6 animate-spin" />}이 기기 연결하기
          </button>
          <button type="button" disabled={busy} onClick={() => { setFromQr(false); setCode(""); }} className="mt-3 h-12 w-full rounded-lg text-lg font-medium text-slate-600">취소</button>
        </div>
      ) : (
        <form className="w-full max-w-md rounded-xl bg-white p-8 text-slate-900" onSubmit={(e) => { e.preventDefault(); void connect(); }}>
          <QrCode className="mb-3 size-10 text-blue-900" />
          <h1 className="text-2xl font-bold">등록되지 않은 기기입니다</h1>
          <p className="mt-2 text-slate-600">관리자 화면의 키오스크 관리에서 만든 QR을 이 태블릿의 카메라로 찍어 주세요.</p>
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 font-medium text-red-700">{error} 새 QR을 발급해 주세요.</p>}
          <details className="mt-6">
            <summary className="cursor-pointer text-sm text-slate-500">카메라를 쓸 수 없나요? 코드 직접 입력</summary>
            <label htmlFor="pairing-code" className="mt-3 block text-sm font-medium">연결 코드</label>
            <input id="pairing-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false}
              placeholder="XXXX-XXXX" maxLength={9}
              className="mt-1.5 h-16 w-full select-text rounded-lg border-2 border-slate-300 text-center font-mono text-3xl tracking-widest outline-none focus:border-blue-800" />
            <button type="submit" disabled={busy || code.length < 8} className="mt-3 flex h-16 w-full items-center justify-center gap-2 rounded-lg bg-blue-900 text-xl font-bold text-white disabled:opacity-40">
              {busy && <Loader2 className="size-5 animate-spin" />}연결하기
            </button>
          </details>
        </form>
      )}
    </div>
  );
}

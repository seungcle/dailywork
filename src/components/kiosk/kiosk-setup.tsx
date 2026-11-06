"use client";
import { useState } from "react";
import { Loader2, TabletSmartphone } from "lucide-react";
import { api } from "@/lib/api";

export function KioskSetup() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <form className="w-full max-w-md rounded-xl bg-white p-8 text-slate-900" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try {
          await api("/api/kiosk/setup", { body: { code } });
          window.location.replace("/kiosk");
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}>
        <TabletSmartphone className="mb-3 size-9 text-blue-900" />
        <h1 className="text-2xl font-bold">등록되지 않은 기기입니다</h1>
        <p className="mt-2 text-slate-600">관리자 화면의 키오스크 관리에서 발급한 연결 코드를 입력해 주세요.</p>
        <label htmlFor="pairing-code" className="mt-6 block text-sm font-medium">연결 코드</label>
        <input id="pairing-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false}
          placeholder="XXXX-XXXX" maxLength={9}
          className="mt-1.5 h-16 w-full select-text rounded-lg border-2 border-slate-300 text-center font-mono text-3xl tracking-widest outline-none focus:border-blue-800" />
        {error && <p role="alert" className="mt-3 font-medium text-red-600">{error}</p>}
        <button type="submit" disabled={busy || code.length < 8} className="mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-lg bg-blue-900 text-xl font-bold text-white disabled:opacity-40">
          {busy && <Loader2 className="size-5 animate-spin" />}연결하기
        </button>
      </form>
    </div>
  );
}

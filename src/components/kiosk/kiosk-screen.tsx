"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Delete, Loader2, LogIn, LogOut, XCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Lookup = { workerNumber: number; maskedName: string; state: "can_clock_in" | "can_clock_out" | "completed_today" | "needs_admin" };
type Screen =
  | { kind: "input" }
  | { kind: "confirm"; worker: Lookup }
  | { kind: "result"; ok: true; action: "clock_in" | "clock_out"; name: string; at: string }
  | { kind: "result"; ok: false; message: string };

const MAX_DIGITS = 8;
const RESULT_MS = 4000;
const CONFIRM_IDLE_MS = 20000;

const STATE_HINT: Record<Lookup["state"], string | null> = {
  can_clock_in: null,
  can_clock_out: null,
  completed_today: "오늘은 이미 출퇴근을 완료했습니다.",
  needs_admin: "이전 근무의 퇴근 기록이 없습니다. 관리자에게 문의해 주세요.",
};

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // 서버 렌더링과 시각이 어긋나지 않도록 브라우저에서만 표시한다.
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  if (!now) return <div className="h-14" />;
  return (
    <div className="text-right">
      <div className="text-4xl font-bold tabular-nums">{formatTime(now.toISOString())}</div>
      <div className="text-sm text-blue-200">{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(now)}</div>
    </div>
  );
}

export function KioskScreen({ deviceName }: { deviceName: string }) {
  const [digits, setDigits] = useState("");
  const [screen, setScreen] = useState<Screen>({ kind: "input" });
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => { setDigits(""); setScreen({ kind: "input" }); }, []);

  // 결과 화면과 확인 화면은 잠시 뒤 자동으로 처음으로 돌아간다.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (screen.kind === "result") timer.current = setTimeout(reset, RESULT_MS);
    if (screen.kind === "confirm") timer.current = setTimeout(reset, CONFIRM_IDLE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [screen, reset]);

  // 태블릿 화면이 꺼지지 않게 요청한다(지원 기기에서만).
  useEffect(() => {
    let lock: { release?: () => Promise<void> } | null = null;
    const request = async () => {
      try { lock = await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null; } catch { /* 지원하지 않으면 무시 */ }
    };
    void request();
    const onVisible = () => { if (document.visibilityState === "visible") void request(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); void lock?.release?.(); };
  }, []);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.code === "KIOSK_NOT_REGISTERED") {
      window.location.replace("/kiosk/setup");
      return;
    }
    setScreen({ kind: "result", ok: false, message: (e as Error).message });
  }, []);

  const submitNumber = useCallback(async () => {
    if (!digits || busy) return;
    setBusy(true);
    try {
      const worker = await api<Lookup>("/api/kiosk/lookup", { body: { workerNumber: Number(digits) } });
      setScreen({ kind: "confirm", worker });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [digits, busy, fail]);

  const record = useCallback(async (worker: Lookup, action: "clock_in" | "clock_out") => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ at: string; maskedName: string }>("/api/kiosk/attendance", { body: { workerNumber: worker.workerNumber, action } });
      setScreen({ kind: "result", ok: true, action, name: r.maskedName, at: r.at });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [busy, fail]);

  const press = useCallback((d: string) => setDigits((v) => (v.length >= MAX_DIGITS ? v : v + d)), []);
  const back = useCallback(() => setDigits((v) => v.slice(0, -1)), []);

  // 외장 키보드 입력 지원
  useEffect(() => {
    if (screen.kind !== "input") return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") void submitNumber();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen.kind, press, back, submitNumber]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-8 py-4">
        <div>
          <div className="text-xl font-bold">출퇴근 체크</div>
          <div className="text-sm text-blue-200">{deviceName}</div>
        </div>
        <Clock />
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 pb-6">
        {screen.kind === "input" && (
          <div className="flex w-full max-w-md flex-col gap-3">
            <div aria-live="polite" className={cn("flex h-20 shrink-0 items-center justify-center rounded-xl bg-white/10 text-5xl font-bold tracking-[0.2em] tabular-nums", !digits && "text-2xl font-medium tracking-normal text-blue-200")}>
              {digits || "번호를 입력하세요"}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <Key key={d} onClick={() => press(d)}>{d}</Key>
              ))}
              <Key onClick={back} aria-label="한 글자 지우기" muted><Delete className="size-9" /></Key>
              <Key onClick={() => press("0")}>0</Key>
              <Key onClick={() => setDigits("")} muted className="text-2xl">전체삭제</Key>
            </div>
            <button type="button" disabled={!digits || busy} onClick={submitNumber}
              className="flex h-20 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-500 text-3xl font-bold active:bg-blue-600 disabled:opacity-40">
              {busy && <Loader2 className="size-7 animate-spin" />}확인
            </button>
          </div>
        )}

        {screen.kind === "confirm" && (
          <div className="flex w-full max-w-3xl flex-col items-center gap-7 text-center">
            <div>
              <div className="text-lg text-blue-200">번호 {screen.worker.workerNumber}</div>
              <div className="mt-1 text-6xl font-bold">{screen.worker.maskedName} 님</div>
              <div className="mt-3 text-xl text-blue-100">본인이 맞으면 아래 버튼을 눌러 주세요.</div>
            </div>
            {STATE_HINT[screen.worker.state] && <div className="rounded-lg bg-amber-400 px-5 py-3 text-xl font-semibold text-slate-900">{STATE_HINT[screen.worker.state]}</div>}
            <div className="grid w-full grid-cols-2 gap-5">
              <button type="button" disabled={busy || screen.worker.state !== "can_clock_in"} onClick={() => record((screen as { worker: Lookup }).worker, "clock_in")}
                className="flex h-44 flex-col items-center justify-center gap-2 rounded-2xl bg-blue-500 text-4xl font-bold active:bg-blue-600 disabled:bg-white/10 disabled:text-white/30">
                <LogIn className="size-11" />출근하기
              </button>
              <button type="button" disabled={busy || screen.worker.state !== "can_clock_out"} onClick={() => record((screen as { worker: Lookup }).worker, "clock_out")}
                className="flex h-44 flex-col items-center justify-center gap-2 rounded-2xl bg-orange-500 text-4xl font-bold active:bg-orange-600 disabled:bg-white/10 disabled:text-white/30">
                <LogOut className="size-11" />퇴근하기
              </button>
            </div>
            <button type="button" onClick={reset} className="h-16 w-64 rounded-xl bg-white/15 text-2xl font-semibold active:bg-white/25">취소</button>
          </div>
        )}

        {screen.kind === "result" && (
          <button type="button" onClick={reset} className={cn("flex h-full max-h-[34rem] w-full max-w-3xl flex-col items-center justify-center gap-5 rounded-3xl px-8 text-center", screen.ok ? "bg-emerald-600" : "bg-red-600")} role="status">
            {screen.ok ? <CheckCircle2 className="size-28" /> : <XCircle className="size-28" />}
            {screen.ok ? (
              <>
                <div className="text-5xl font-bold">{screen.action === "clock_in" ? "출근" : "퇴근"} 완료</div>
                <div className="text-3xl">{screen.name} 님 · {formatTime(screen.at)}</div>
              </>
            ) : (
              <>
                <div className="text-5xl font-bold">처리되지 않았습니다</div>
                <div className="text-3xl leading-snug">{screen.message}</div>
              </>
            )}
            <div className="mt-2 text-lg opacity-80">잠시 후 처음 화면으로 돌아갑니다.</div>
          </button>
        )}
      </main>
    </div>
  );
}

function Key({ children, muted, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { muted?: boolean }) {
  return (
    <button type="button" {...props} className={cn("flex h-20 items-center justify-center rounded-xl text-4xl font-semibold tabular-nums", muted ? "bg-white/5 active:bg-white/20" : "bg-white/15 active:bg-white/30", className)}>
      {children}
    </button>
  );
}

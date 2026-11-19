"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/admin/common";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiData } from "@/hooks/use-api-data";
import { api } from "@/lib/api";
import { parseMoney } from "@/lib/format";

type Settings = { admin: { username: string; displayName: string }; defaultDailyWage: number };

export default function SettingsPage() {
  const { data, reload } = useApiData<Settings>("/api/admin/settings");
  return (
    <>
      <PageHeader title="설정" description={data ? `${data.admin.displayName} (${data.admin.username})` : undefined} />
      <div className="max-w-md space-y-6">
        {data && <WagePanel key={data.defaultDailyWage} current={data.defaultDailyWage} onSaved={reload} />}
        <PasswordPanel />
      </div>
    </>
  );
}

function WagePanel({ current, onSaved }: { current: number; onSaved: () => void }) {
  const [value, setValue] = useState(current ? String(current) : "");
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const wage = parseMoney(value);
  const save = async (applyToAll: boolean) => {
    if (wage === null) return;
    setBusy(true);
    try {
      const r = await api<{ workersChanged: number }>("/api/admin/settings/daily-wage", { method: "PUT", body: { defaultDailyWage: wage, applyToAll } });
      toast.success(applyToAll ? `기본 일당을 저장하고 근무자 ${r.workersChanged}명의 일당을 바꿨습니다.` : "기본 일당을 저장했습니다. 새로 등록하는 근무자에게 적용됩니다.");
      onSaved();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); setConfirmAll(false); }
  };
  return (
    <Panel title="기본 일당">
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); void save(false); }}>
        <div className="space-y-1.5">
          <Label htmlFor="default-wage">기본 일당 (원)</Label>
          <Input id="default-wage" inputMode="numeric" placeholder="96700" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={wage === null} />
          <p className="text-xs text-muted-foreground">{wage === null ? "숫자로 입력해 주세요." : "신규 근무자 등록 화면에 이 금액이 미리 채워집니다."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || wage === null}>{busy && <Loader2 className="size-4 animate-spin" />}저장</Button>
          <Button type="button" variant="outline" disabled={busy || wage === null} onClick={() => setConfirmAll(true)}>모든 근무자에게 적용</Button>
        </div>
      </form>
      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} title="모든 근무자 일당 변경" confirmLabel="모두 변경"
        description={`등록된 모든 근무자의 기본 일당을 ${(wage ?? 0).toLocaleString()}원으로 바꿉니다. 이미 찍힌 출근 기록의 일당은 바뀌지 않습니다.`}
        onConfirm={() => save(true)} />
    </Panel>
  );
}

function PasswordPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = !!confirm && next !== confirm;
  return (
    <Panel title="비밀번호 변경">
      <form className="space-y-3 p-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/api/admin/settings/password", { body: { current, next } });
          toast.success("비밀번호를 변경했습니다. 다른 기기의 로그인은 해제됩니다.");
          setCurrent(""); setNext(""); setConfirm("");
        } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
      }}>
        <div className="space-y-1.5"><Label htmlFor="pw-cur">현재 비밀번호</Label><Input id="pw-cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pw-new">새 비밀번호 (4자 이상)</Label><Input id="pw-new" type="password" autoComplete="new-password" required minLength={4} value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pw-conf">새 비밀번호 확인</Label><Input id="pw-conf" type="password" autoComplete="new-password" required aria-invalid={mismatch} value={confirm} onChange={(e) => setConfirm(e.target.value)} />{mismatch && <p className="text-xs text-destructive">새 비밀번호가 일치하지 않습니다.</p>}</div>
        <Button type="submit" disabled={busy || mismatch || !next || next !== confirm}>{busy && <Loader2 className="size-4 animate-spin" />}변경</Button>
      </form>
    </Panel>
  );
}

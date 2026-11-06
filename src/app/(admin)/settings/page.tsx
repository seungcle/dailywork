"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiData } from "@/hooks/use-api-data";
import { api } from "@/lib/api";

type Settings = { admin: { username: string; displayName: string } };

export default function SettingsPage() {
  const { data } = useApiData<Settings>("/api/admin/settings");
  return (
    <>
      <PageHeader title="설정" description={data ? `${data.admin.displayName} (${data.admin.username})` : undefined} />
      <div className="max-w-md">
        <PasswordPanel />
      </div>
    </>
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

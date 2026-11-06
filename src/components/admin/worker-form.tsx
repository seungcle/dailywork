"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError } from "@/lib/api";
import { formatPhone, formatPhoneInput, parseMoney } from "@/lib/format";

export type WorkerFormValue = { name: string; phone: string; baseDailyWage: string; bankName: string; accountNumber: string; accountHolder: string; rrn: string; memo: string };
const EMPTY: WorkerFormValue = { name: "", phone: "", baseDailyWage: "", bankName: "", accountNumber: "", accountHolder: "", rrn: "", memo: "" };
type Candidate = { id: string; name: string; phone: string | null; is_active: boolean; reasons: string[]; strong: boolean };

type Props = {
  onOpenChange: (o: boolean) => void; workerId?: string; initial?: Partial<WorkerFormValue>; hasAccount?: boolean;
  rrnEnabled: boolean; hasRrn?: boolean; onSaved: (r: { id: string }) => void;
};

/** 열릴 때마다 입력값을 새로 시작하도록 닫혀 있으면 렌더링하지 않는다. */
export function WorkerFormDialog({ open, ...props }: Props & { open: boolean }) {
  return open ? <WorkerForm {...props} /> : null;
}

function WorkerForm({ onOpenChange, workerId, initial, hasAccount, rrnEnabled, hasRrn, onSaved }: Props) {
  const [v, setV] = useState<WorkerFormValue>({ ...EMPTY, ...initial, phone: formatPhoneInput(initial?.phone ?? "") });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = !!workerId;

  const set = (k: keyof WorkerFormValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setBlocked(false); setV((x) => ({ ...x, [k]: e.target.value })); };

  const check = async () => {
    if (!v.name.trim() && !v.phone.trim() && !v.accountNumber.trim() && !v.rrn.trim()) return setCandidates([]);
    try {
      const r = await api<{ candidates: Candidate[] }>("/api/admin/workers/duplicates", { body: { name: v.name, phone: v.phone, accountNumber: v.accountNumber, rrn: v.rrn, excludeId: workerId } });
      setCandidates(r.candidates);
    } catch { /* 후보 확인 실패는 저장 때 서버가 다시 검사한다 */ }
  };

  const submit = async (allowDuplicate: boolean) => {
    const wage = parseMoney(v.baseDailyWage);
    if (wage === null) { setError("기본 일당은 숫자로 입력해 주세요."); return; }
    const worker = {
      name: v.name, phone: v.phone || null, baseDailyWage: wage, bankName: v.bankName || null, accountNumber: v.accountNumber || null,
      accountHolder: v.accountHolder || null, rrn: v.rrn || null, memo: v.memo,
    };
    setBusy(true); setError(null);
    try {
      if (editing) {
        await api(`/api/admin/workers/${workerId}`, { method: "PATCH", body: worker });
        toast.success("근무자 정보를 수정했습니다.");
        onSaved({ id: workerId });
      } else {
        const r = await api<{ id: string }>("/api/admin/workers", { body: { worker, allowDuplicate } });
        toast.success("등록했습니다. 이 휴대폰 번호로 바로 출퇴근할 수 있습니다.");
        onSaved(r);
      }
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_WORKER") {
        setCandidates((e.details as { candidates: Candidate[] }).candidates);
        setBlocked(true);
      } else setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "근무자 정보 수정" : "신규 근무자 등록"}</DialogTitle>
          <DialogDescription>근무자는 키오스크에서 휴대폰 번호로 출퇴근합니다.</DialogDescription>
        </DialogHeader>
        <form id="worker-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
          <F id="w-name" label="이름 *"><Input id="w-name" required value={v.name} onChange={set("name")} onBlur={check} /></F>
          <F id="w-phone" label="휴대폰 번호 *"><Input id="w-phone" required inputMode="tel" placeholder="010-0000-0000" value={v.phone} onChange={(e) => { setBlocked(false); setV((x) => ({ ...x, phone: formatPhoneInput(e.target.value) })); }} onBlur={check} /></F>
          <F id="w-wage" label="기본 일당 (원)"><Input id="w-wage" inputMode="numeric" placeholder="150000" value={v.baseDailyWage} onChange={set("baseDailyWage")} /></F>
          <F id="w-bank" label="은행명"><Input id="w-bank" value={v.bankName} onChange={set("bankName")} /></F>
          <F id="w-account" label="계좌번호" hint={editing && hasAccount ? "변경할 때만 입력하세요." : undefined}>
            <Input id="w-account" inputMode="numeric" autoComplete="off" value={v.accountNumber} onChange={set("accountNumber")} onBlur={check} />
          </F>
          <F id="w-holder" label="예금주"><Input id="w-holder" value={v.accountHolder} onChange={set("accountHolder")} /></F>
          {rrnEnabled && (
            <F id="w-rrn" label="주민등록번호" hint={editing && hasRrn ? "변경할 때만 입력하세요." : "수집 근거가 확인된 경우에만 입력하세요."}>
              <Input id="w-rrn" autoComplete="off" value={v.rrn} onChange={set("rrn")} onBlur={check} />
            </F>
          )}
          <div className="col-span-2 space-y-1.5"><Label htmlFor="w-memo">메모</Label><Textarea id="w-memo" rows={2} value={v.memo} onChange={set("memo")} /></div>
        </form>

        {candidates.length > 0 && (
          <div className={`rounded border p-3 text-sm ${candidates.some((c) => c.strong) ? "border-amber-300 bg-amber-50" : "bg-muted"}`}>
            <div className="mb-2 flex items-center gap-1.5 font-medium"><AlertTriangle className="size-4 text-amber-600" />이미 등록된 사람일 수 있습니다</div>
            <ul className="space-y-1.5">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span><b>{c.name}</b> {formatPhone(c.phone)} · <span className="text-xs text-muted-foreground">{c.reasons.join(", ")}{c.is_active ? "" : " · 비활성"}</span></span>
                  <Button asChild size="xs" variant="outline"><Link href={`/workers/${c.id}`}>기존 정보 보기</Link></Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>취소</Button>
          {blocked
            ? <Button variant="destructive" disabled={busy} onClick={() => submit(true)}>다른 사람이 맞음, 그래도 등록</Button>
            : <Button type="submit" form="worker-form" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}저장</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function F({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

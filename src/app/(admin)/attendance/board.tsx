"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CopyPlus, Download, History, Loader2, Pencil, Search, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AttendanceBadge, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Panel, StatCard, WageBadge } from "@/components/admin/common";
import { WorkerPicker, type PickedWorker } from "@/components/admin/worker-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useApiData } from "@/hooks/use-api-data";
import { api } from "@/lib/api";
import { addDays, formatClock, formatDateTime, formatWon, fromKstInput, kstDate, toKstInput } from "@/lib/format";

type Row = {
  record_id: string; worker_id: string; worker_number: number; name: string; work_date: string; clock_in_at: string | null; clock_out_at: string | null;
  source: string; base_wage: number; actual_wage: number; extra_pay: number; final_wage: number; wage_status: string; attendance_status: string;
};
type Daily = { date: string; rows: Row[]; summary: { total: number; working: number; done: number; scheduled: number; missingOut: number; totalWage: number } };

export function AttendanceBoard({ date }: { date: string }) {
  const router = useRouter();
  const today = kstDate();
  const setDate = (d: string) => { if (d) router.replace(`/attendance?date=${d}`); };
  const { data, error, loading, reload } = useApiData<Daily>(`/api/admin/attendance?date=${date}`, { pollMs: 15000 });
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim();
    if (!data) return [];
    return s ? data.rows.filter((r) => r.name.includes(s) || String(r.worker_number).startsWith(s)) : data.rows;
  }, [data, q]);
  const stale = data && data.date !== date;

  return (
    <>
      <PageHeader title="일일 출석부" description="키오스크와 수동 등록 기록을 한곳에서 확인합니다. 15초마다 자동 갱신됩니다.">
        <Button variant="outline" onClick={() => setCopyOpen(true)}><CopyPlus className="size-4" />전날 인원 불러오기</Button>
        <Button variant="outline" asChild><a href={`/api/admin/excel/export?type=attendance&date=${date}`}><Download className="size-4" />Excel</a></Button>
        <Button onClick={() => setAddOpen(true)}><UserPlus className="size-4" />근무자 추가</Button>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="이전 날짜" onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="size-4" /></Button>
        <Input type="date" aria-label="날짜 선택" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button variant="outline" size="icon" aria-label="다음 날짜" onClick={() => setDate(addDays(date, 1))}><ChevronRight className="size-4" /></Button>
        {date !== today && <Button variant="ghost" onClick={() => setDate(today)}>오늘로</Button>}
      </div>

      {error && !data ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <LoadingState /> : data && (
        <div className={stale ? "opacity-60 transition-opacity" : undefined}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="총 근무 인원" value={`${data.summary.total}명`} />
            <StatCard label="근무 중" value={`${data.summary.working}명`} tone="primary" />
            <StatCard label="퇴근 완료" value={`${data.summary.done}명`} />
            <StatCard label="출근 전 · 누락" value={`${data.summary.scheduled} · ${data.summary.missingOut}`} tone={data.summary.missingOut ? "warn" : undefined} />
            <StatCard label="총 일당" value={formatWon(data.summary.totalWage)} />
          </div>
          <Panel className="mt-4" title={`출석 명단 (${rows.length}명)`} actions={
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-7 w-44 pl-7 text-xs" placeholder="이름·번호 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          }>
            {rows.length === 0 ? <EmptyState>{q ? "검색 결과가 없습니다." : "이 날짜의 출석 기록이 없습니다. 키오스크로 출근하거나 근무자를 추가하면 표시됩니다."}</EmptyState> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">번호</TableHead><TableHead>이름</TableHead><TableHead>출근</TableHead><TableHead>퇴근</TableHead><TableHead>상태</TableHead><TableHead>등록</TableHead>
                    <TableHead className="w-32 text-right">당일 일당</TableHead><TableHead className="w-28 text-right">추가 지급</TableHead><TableHead className="text-right">최종 일당</TableHead><TableHead>정산</TableHead><TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.record_id}>
                      <TableCell className="tabular-nums">{r.worker_number}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="tabular-nums">{formatClock(r.clock_in_at, r.work_date)}</TableCell>
                      <TableCell className="tabular-nums">{formatClock(r.clock_out_at, r.work_date)}</TableCell>
                      <TableCell><AttendanceBadge status={r.attendance_status} /></TableCell>
                      <TableCell><Badge variant="outline">{r.source === "kiosk" ? "키오스크" : "수동"}</Badge></TableCell>
                      <TableCell className="text-right"><MoneyCell key={`a-${r.record_id}-${r.actual_wage}`} recordId={r.record_id} field="actualWage" value={r.actual_wage} label={`${r.name} 당일 일당`} disabled={r.wage_status === "confirmed"} onSaved={reload} /></TableCell>
                      <TableCell className="text-right"><MoneyCell key={`e-${r.record_id}-${r.extra_pay}`} recordId={r.record_id} field="extraPay" value={r.extra_pay} label={`${r.name} 추가 지급액`} disabled={r.wage_status === "confirmed"} onSaved={reload} /></TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{r.final_wage.toLocaleString()}</TableCell>
                      <TableCell><WageBadge status={r.wage_status} /></TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button variant="ghost" size="icon-sm" aria-label={`${r.name} 출퇴근 시각 수정`} title="시각 수정" disabled={r.wage_status === "confirmed"} onClick={() => setEditing(r)}><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`${r.name} 변경 이력`} title="변경 이력" onClick={() => setHistory(r)}><History className="size-3.5" /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`${r.name} 기록 삭제`} title="삭제" disabled={r.wage_status === "confirmed"} onClick={() => setDeleting(r)}><Trash2 className="size-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </div>
      )}

      {addOpen && <AddDialog onOpenChange={setAddOpen} date={date} onDone={reload} />}
      {editing && <EditDialog row={editing} onClose={() => setEditing(null)} onDone={reload} />}
      {history && <HistoryDialog row={history} onClose={() => setHistory(null)} />}
      <ConfirmDialog open={copyOpen} onOpenChange={setCopyOpen} title="전날 인원 불러오기" confirmLabel="불러오기"
        description={`${addDays(date, -1)} 출석 인원을 ${date} 출석부에 시각 없이 추가합니다. 실제로 나오지 않은 사람은 정산 전에 삭제해 주세요.`}
        onConfirm={async () => {
          try {
            const r = await api<{ created: number; skipped: unknown[]; previousCount: number }>("/api/admin/attendance/copy-previous", { body: { workDate: date } });
            if (r.previousCount === 0) toast.info("전날 출석 기록이 없습니다.");
            else toast.success(`${r.created}명을 추가했습니다.${r.skipped.length ? ` (이미 있는 ${r.skipped.length}명 제외)` : ""}`);
            void reload();
          } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="출석 기록 삭제" destructive confirmLabel="삭제" reasonLabel="삭제 사유"
        description={deleting && `${deleting.name}(${deleting.worker_number}) 님의 ${deleting.work_date} 기록을 출석부와 정산에서 뺍니다. 이력은 남습니다.`}
        onConfirm={async (reason) => {
          try {
            await api(`/api/admin/attendance/${deleting!.record_id}`, { method: "DELETE", body: { reason } });
            toast.success("기록을 삭제했습니다.");
            void reload();
          } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
    </>
  );
}

/** 표에서 바로 고치는 금액 칸. 포커스를 벗어나거나 Enter를 누르면 저장한다. */
function MoneyCell({ recordId, field, value, label, disabled, onSaved }: { recordId: string; field: "actualWage" | "extraPay"; value: number; label: string; disabled: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = draft ?? value.toLocaleString();
  const save = async () => {
    if (draft === null) return;
    const n = Number(draft.replace(/[,\s]/g, ""));
    if (!Number.isInteger(n) || n < 0) { toast.error("금액은 0 이상의 숫자로 입력해 주세요."); setDraft(null); return; }
    if (n === value) { setDraft(null); return; }
    setSaving(true);
    try {
      await api(`/api/admin/attendance/${recordId}/wage`, { method: "PATCH", body: { [field]: n } });
      toast.success(`${label}: ${n.toLocaleString()}원 저장`);
      onSaved();
    } catch (e) { toast.error((e as Error).message); setDraft(null); } finally { setSaving(false); }
  };
  return (
    <Input aria-label={label} inputMode="numeric" disabled={disabled || saving} className="ml-auto h-7 w-24 text-right tabular-nums" value={shown}
      onFocus={(e) => { setDraft(String(value)); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setDraft(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(null); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); } }} />
  );
}

function AddDialog({ onOpenChange, date, onDone }: { onOpenChange: (o: boolean) => void; date: string; onDone: () => void }) {
  const [selected, setSelected] = useState<PickedWorker[]>([]);
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{date} 출석 등록</DialogTitle>
          <DialogDescription>여러 명을 한 번에 추가할 수 있습니다. 시각을 비워 두면 키오스크 출근 때 채워집니다.</DialogDescription>
        </DialogHeader>
        <WorkerPicker selected={selected} onChange={setSelected} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="add-in">출근 시각 (선택)</Label><Input id="add-in" type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="add-out">퇴근 시각 (선택)</Label><Input id="add-out" type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>취소</Button>
          <Button disabled={busy || selected.length === 0} onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ created: number; skipped: { reason: string }[] }>("/api/admin/attendance", {
                body: { workerIds: selected.map((s) => s.id), workDate: date, clockInAt: fromKstInput(clockIn), clockOutAt: fromKstInput(clockOut) },
              });
              if (r.created) toast.success(`${r.created}명을 등록했습니다.`);
              r.skipped.forEach((s) => toast.warning(s.reason));
              onDone();
              onOpenChange(false);
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>{busy && <Loader2 className="size-4 animate-spin" />}{selected.length}명 등록</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const [clockIn, setClockIn] = useState(toKstInput(row.clock_in_at));
  const [clockOut, setClockOut] = useState(toKstInput(row.clock_out_at));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>출퇴근 시각 보정</DialogTitle>
          <DialogDescription>{row.name} ({row.worker_number}) · 근무일 {row.work_date}. 자정을 넘긴 근무는 퇴근 날짜를 다음 날로 입력하세요.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="ed-in">출근 시각</Label><Input id="ed-in" type="datetime-local" value={clockIn} onChange={(e) => setClockIn(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="ed-out">퇴근 시각</Label><Input id="ed-out" type="datetime-local" value={clockOut} onChange={(e) => setClockOut(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="ed-reason">수정 사유 (필수)</Label><Textarea id="ed-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 퇴근 체크 누락, 본인 확인 후 입력" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>취소</Button>
          <Button disabled={busy || !reason.trim()} onClick={async () => {
            setBusy(true);
            try {
              await api(`/api/admin/attendance/${row.record_id}`, { method: "PATCH", body: { clockInAt: fromKstInput(clockIn), clockOutAt: fromKstInput(clockOut), reason } });
              toast.success("출퇴근 시각을 수정했습니다.");
              onDone();
              onClose();
            } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
          }}>{busy && <Loader2 className="size-4 animate-spin" />}저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACTIONS: Record<string, string> = {
  "attendance.correct": "시각 보정", "attendance.manual_create": "수동 등록", "attendance.delete": "삭제",
  "wage.update": "일당 수정", "wage.confirm": "정산 확정", "wage.unconfirm": "확정 해제",
};
const FIELDS: Record<string, string> = { clock_in_at: "출근", clock_out_at: "퇴근", actual_wage: "당일 일당", extra_pay: "추가 지급", note: "비고", work_date: "근무일", worker_number: "번호" };
function fmt(v: unknown) {
  if (v === null || v === undefined || v === "") return "없음";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v);
  return typeof v === "number" ? v.toLocaleString() : String(v);
}
function changes(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null) || !before)
    .map((k) => `${FIELDS[k] ?? k}: ${before ? `${fmt(before[k])} → ` : ""}${fmt(after?.[k])}`);
}

function HistoryDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const { data, loading } = useApiData<{ logs: { id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null; created_at: string; admin_name: string | null }[] }>(`/api/admin/attendance/${row.record_id}/history`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>변경 이력</DialogTitle><DialogDescription>{row.name} ({row.worker_number}) · {row.work_date}</DialogDescription></DialogHeader>
        {loading ? <LoadingState /> : data?.logs.length === 0 ? <EmptyState>관리자가 변경한 내역이 없습니다.</EmptyState> : (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {data?.logs.map((l) => (
              <li key={l.id} className="rounded border p-2.5 text-sm">
                <div className="flex justify-between gap-2"><span className="font-medium">{ACTIONS[l.action] ?? l.action}</span><span className="text-xs text-muted-foreground">{formatDateTime(l.created_at)} · {l.admin_name ?? "-"}</span></div>
                {changes(l.before, l.after).map((c) => <div key={c} className="mt-1 text-xs text-muted-foreground">{c}</div>)}
                {l.reason && <div className="mt-1 text-xs">사유: {l.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, LoadingState, PageHeader, Panel } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiData } from "@/hooks/use-api-data";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type Settings = { maxShiftHours: number; rrnEnabled: boolean; admin: { username: string; displayName: string } };
type Log = { id: string; action: string; target_type: string; target_id: string | null; reason: string | null; created_at: string; admin_name: string | null };

const ACTIONS: Record<string, string> = {
  "attendance.correct": "출퇴근 시각 보정", "attendance.manual_create": "수동 출석 등록", "attendance.delete": "출석 기록 삭제",
  "wage.update": "일당 수정", "wage.confirm": "정산 확정", "wage.unconfirm": "정산 확정 해제",
  "worker.create": "근무자 등록", "worker.update": "근무자 수정", "worker.activate": "근무자 활성화", "worker.deactivate": "근무자 비활성화",
  "worker.reveal_account": "계좌번호 조회", "worker.reveal_rrn": "주민등록번호 조회",
  "kiosk.register": "키오스크 등록", "kiosk.reissue_code": "연결 코드 재발급", "kiosk.revoke": "키오스크 연결 해제", "kiosk.paired": "키오스크 연결",
  "settings.update": "설정 변경", "admin.password_change": "비밀번호 변경", "excel.import.workers": "근무자 Excel 가져오기",
  "excel.export.workers": "근무자 명부 다운로드", "excel.export.attendance": "출석부 다운로드", "excel.export.records": "근무 기록 다운로드",
  "excel.export.wage-summary": "일당 합계 다운로드", "excel.export.payment": "지급 자료 다운로드",
};

export default function SettingsPage() {
  const { data, reload } = useApiData<Settings>("/api/admin/settings");
  return (
    <>
      <PageHeader title="설정" description={data ? `${data.admin.displayName} (${data.admin.username})` : undefined} />
      {!data ? <LoadingState /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ShiftPanel key={data.maxShiftHours} value={data.maxShiftHours} onSaved={reload} />
          <PasswordPanel />
          <Panel title="주민등록번호 수집" className="lg:col-span-2">
            <p className="p-4 text-sm">
              현재 <b>{data.rrnEnabled ? "사용" : "사용 안 함"}</b> 상태입니다.{" "}
              <span className="text-muted-foreground">수집 필요성과 법적 처리 근거를 확인한 뒤 운영 환경변수 RRN_COLLECTION_ENABLED로 변경합니다. 사용하지 않으면 입력란과 Excel 가져오기 항목이 표시되지 않습니다.</span>
            </p>
          </Panel>
        </div>
      )}
      <AuditPanel />
    </>
  );
}

function ShiftPanel({ value, onSaved }: { value: number; onSaved: () => void }) {
  const [v, setV] = useState(String(value));
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="출퇴근 규칙">
      <form className="space-y-3 p-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/api/admin/settings", { method: "PATCH", body: { maxShiftHours: Number(v) } });
          toast.success("저장했습니다.");
          onSaved();
        } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
      }}>
        <div className="space-y-1.5">
          <Label htmlFor="max-shift">최대 근무 시간 (시간)</Label>
          <Input id="max-shift" type="number" min={1} max={72} className="w-28" value={v} onChange={(e) => setV(e.target.value)} />
          <p className="text-xs text-muted-foreground">출근 후 이 시간이 지나도록 퇴근하지 않으면 ‘퇴근 누락’으로 표시되고, 관리자가 보정할 때까지 키오스크 퇴근과 재출근이 막힙니다. 야간 근무가 있으면 충분히 길게 잡으세요.</p>
        </div>
        <Button type="submit" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}저장</Button>
      </form>
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
        <div className="space-y-1.5"><Label htmlFor="pw-new">새 비밀번호 (10자 이상)</Label><Input id="pw-new" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="pw-conf">새 비밀번호 확인</Label><Input id="pw-conf" type="password" autoComplete="new-password" required aria-invalid={mismatch} value={confirm} onChange={(e) => setConfirm(e.target.value)} />{mismatch && <p className="text-xs text-destructive">새 비밀번호가 일치하지 않습니다.</p>}</div>
        <Button type="submit" disabled={busy || mismatch || !next}>{busy && <Loader2 className="size-4 animate-spin" />}변경</Button>
      </form>
    </Panel>
  );
}

function AuditPanel() {
  const [page, setPage] = useState(1);
  const { data, loading } = useApiData<{ logs: Log[] }>(`/api/admin/audit-logs?page=${page}`);
  return (
    <Panel className="mt-4" title="변경 이력">
      {loading && !data ? <LoadingState /> : data?.logs.length === 0 ? <EmptyState>이력이 없습니다.</EmptyState> : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead>시각</TableHead><TableHead>담당자</TableHead><TableHead>작업</TableHead><TableHead>사유</TableHead></TableRow></TableHeader>
            <TableBody>
              {data?.logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="tabular-nums">{formatDateTime(l.created_at)}</TableCell>
                  <TableCell>{l.admin_name ?? "시스템"}</TableCell>
                  <TableCell>{ACTIONS[l.action] ?? l.action}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{l.reason ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-end gap-2 border-t px-4 py-2">
            <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</Button>
            <Button size="xs" variant="outline" disabled={(data?.logs.length ?? 0) < 50} onClick={() => setPage(page + 1)}>다음</Button>
          </div>
        </>
      )}
    </Panel>
  );
}

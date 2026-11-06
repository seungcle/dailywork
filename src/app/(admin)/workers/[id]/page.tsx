"use client";
import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, EyeOff, Pencil, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { AttendanceBadge, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Panel, StatCard, WageBadge } from "@/components/admin/common";
import { WorkerFormDialog } from "@/components/admin/worker-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiData } from "@/hooks/use-api-data";
import { api } from "@/lib/api";
import { formatClock, formatDateTime, formatPhone, formatWon } from "@/lib/format";

type Detail = {
  worker: { id: string; worker_number: number; name: string; phone: string | null; base_daily_wage: number; is_active: boolean; memo: string; created_at: string; last_work_date: string | null; bank_name: string | null; account_last4: string | null; account_holder: string | null; has_rrn: boolean };
  rows: { record_id: string; work_date: string; clock_in_at: string | null; clock_out_at: string | null; source: string; actual_wage: number; extra_pay: number; final_wage: number; status: string }[];
  totals: { work_days: number; total_wage: number; confirmed_wage: number };
  rrnEnabled: boolean;
};

export default function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useApiData<Detail>(`/api/admin/workers/${id}`);
  const [editOpen, setEditOpen] = useState(false);
  const [toggleOpen, setToggleOpen] = useState(false);
  const [revealed, setRevealed] = useState<{ account?: string; rrn?: string }>({});

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const w = data.worker;

  const toggleReveal = async (field: "account" | "rrn") => {
    if (revealed[field]) return setRevealed((r) => ({ ...r, [field]: undefined }));
    try {
      const r = await api<{ value: string }>(`/api/admin/workers/${id}/reveal`, { body: { field } });
      setRevealed((x) => ({ ...x, [field]: r.value }));
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <Link href="/workers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />근무자 목록</Link>
      <PageHeader title={`${w.name} · ${w.worker_number}번`} description={`등록일 ${formatDateTime(w.created_at)}`}>
        <Button variant="outline" onClick={() => setToggleOpen(true)}>{w.is_active ? <><UserX className="size-4" />비활성화</> : <><UserCheck className="size-4" />다시 활성화</>}</Button>
        <Button onClick={() => setEditOpen(true)}><Pencil className="size-4" />정보 수정</Button>
      </PageHeader>
      {!w.is_active && <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">비활성 근무자입니다. 키오스크 출퇴근이 제한됩니다.</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="누적 근무일" value={`${data.totals.work_days}일`} hint={w.last_work_date ? `최근 ${w.last_work_date}` : "근무 기록 없음"} />
        <StatCard label="누적 일당" value={formatWon(data.totals.total_wage)} />
        <StatCard label="확정 금액" value={formatWon(data.totals.confirmed_wage)} tone="primary" />
      </div>
      <Panel className="mt-4" title="기본 정보">
        <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
          <Item label="키오스크 고유번호"><span className="text-lg font-semibold tabular-nums text-primary">{w.worker_number}</span></Item>
          <Item label="상태">{w.is_active ? <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">활성</Badge> : <Badge variant="secondary">비활성</Badge>}</Item>
          <Item label="전화번호">{formatPhone(w.phone)}</Item>
          <Item label="기본 일당">{formatWon(w.base_daily_wage)}</Item>
          <Item label="계좌">
            {w.account_last4 ? (
              <span className="inline-flex items-center gap-2">
                {w.bank_name} {revealed.account ?? `••••${w.account_last4}`} ({w.account_holder})
                <Button variant="ghost" size="icon-xs" aria-label={revealed.account ? "계좌번호 가리기" : "계좌번호 보기"} title="조회 이력이 남습니다" onClick={() => toggleReveal("account")}>{revealed.account ? <EyeOff className="size-3" /> : <Eye className="size-3" />}</Button>
              </span>
            ) : <span className="text-amber-700">미등록</span>}
          </Item>
          {data.rrnEnabled && (
            <Item label="주민등록번호">
              {w.has_rrn ? (
                <span className="inline-flex items-center gap-2">
                  {revealed.rrn ?? "••••••-•••••••"}
                  <Button variant="ghost" size="icon-xs" aria-label={revealed.rrn ? "주민등록번호 가리기" : "주민등록번호 보기"} title="조회 이력이 남습니다" onClick={() => toggleReveal("rrn")}>{revealed.rrn ? <EyeOff className="size-3" /> : <Eye className="size-3" />}</Button>
                </span>
              ) : "미등록"}
            </Item>
          )}
          <Item label="메모" wide>{w.memo || "-"}</Item>
        </dl>
      </Panel>
      <Panel className="mt-4" title="근무 이력 (최근 100건)">
        {data.rows.length === 0 ? <EmptyState>근무 기록이 없습니다.</EmptyState> : (
          <Table>
            <TableHeader><TableRow><TableHead>근무일</TableHead><TableHead>출근</TableHead><TableHead>퇴근</TableHead><TableHead>상태</TableHead><TableHead className="text-right">최종 일당</TableHead><TableHead>정산</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.record_id}>
                  <TableCell><Link className="text-primary hover:underline" href={`/attendance?date=${r.work_date}`}>{r.work_date}</Link></TableCell>
                  <TableCell className="tabular-nums">{formatClock(r.clock_in_at, r.work_date)}</TableCell>
                  <TableCell className="tabular-nums">{formatClock(r.clock_out_at, r.work_date)}</TableCell>
                  <TableCell><AttendanceBadge status={!r.clock_in_at ? "scheduled" : r.clock_out_at ? "done" : "working"} /></TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{r.final_wage.toLocaleString()}</TableCell>
                  <TableCell><WageBadge status={r.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <WorkerFormDialog open={editOpen} onOpenChange={setEditOpen} workerId={w.id} hasAccount={!!w.account_last4} rrnEnabled={data.rrnEnabled} hasRrn={w.has_rrn}
        initial={{ name: w.name, phone: w.phone ?? "", baseDailyWage: String(w.base_daily_wage), bankName: w.bank_name ?? "", accountHolder: w.account_holder ?? "", memo: w.memo }}
        onSaved={() => { setRevealed({}); void reload(); }} />
      <ConfirmDialog open={toggleOpen} onOpenChange={setToggleOpen} destructive={w.is_active} title={w.is_active ? "근무자 비활성화" : "근무자 다시 활성화"} confirmLabel={w.is_active ? "비활성화" : "활성화"}
        description={w.is_active ? `${w.name} 님은 키오스크로 출퇴근할 수 없게 됩니다. 과거 기록은 그대로 유지됩니다.` : `${w.name} 님이 같은 번호로 다시 출퇴근할 수 있습니다.`}
        onConfirm={async () => {
          try {
            await api(`/api/admin/workers/${w.id}/status`, { body: { active: !w.is_active } });
            toast.success(w.is_active ? "비활성화했습니다." : "활성화했습니다.");
            void reload();
          } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
    </>
  );
}

function Item({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? "sm:col-span-2" : undefined}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap">{children}</dd></div>;
}

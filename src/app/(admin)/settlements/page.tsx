"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCheck, ChevronDown, ChevronRight, Download, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Panel, StatCard, WageBadge } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiData } from "@/hooks/use-api-data";
import { api } from "@/lib/api";
import { addDays, formatClock, formatPhone, formatWon, kstDate } from "@/lib/format";

type Row = { worker_id: string; phone: string; name: string; work_days: number; total_wage: number; confirmed_wage: number; pending_wage: number; pending_count: number; confirmed_count: number; open_count: number };
type Report = { rows: Row[]; summary: { workers: number; workDays: number; totalWage: number; confirmedWage: number; pendingWage: number; pendingCount: number } };
type Period = "day" | "week" | "month" | "custom";
type ConfirmResult = { confirmed: number; skippedOpen: number; skippedZero: number };

function rangeOf(p: Period, anchor: string, custom: { from: string; to: string }) {
  if (p === "day") return { from: anchor, to: anchor };
  if (p === "week") {
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7; // 월요일 시작
    const from = addDays(anchor, -dow);
    return { from, to: addDays(from, 6) };
  }
  if (p === "month") {
    const from = `${anchor.slice(0, 7)}-01`;
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return { from, to: addDays(d.toISOString().slice(0, 10), -1) };
  }
  return custom;
}

function notifyConfirm(r: ConfirmResult) {
  if (r.confirmed) toast.success(`${r.confirmed}건을 확정했습니다.`);
  else toast.info("새로 확정된 건이 없습니다.");
  if (r.skippedOpen) toast.warning(`퇴근이 입력되지 않은 ${r.skippedOpen}건은 제외했습니다. 출석부에서 보정해 주세요.`);
  if (r.skippedZero) toast.warning(`0원인 ${r.skippedZero}건은 제외했습니다. 일당을 입력해 주세요.`);
}

export default function SettlementsPage() {
  const today = kstDate();
  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState(today);
  const [custom, setCustom] = useState({ from: addDays(today, -6), to: today });
  const { from, to } = useMemo(() => rangeOf(period, anchor, custom), [period, anchor, custom]);
  const invalid = !from || !to || from > to;
  const { data, error, loading, reload } = useApiData<Report>(invalid ? null : `/api/admin/settlements?from=${from}&to=${to}`);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const refresh = () => { void reload(); setDetailVersion((v) => v + 1); };

  const confirm = async (body: object) => {
    try { notifyConfirm(await api<ConfirmResult>("/api/admin/settlements/confirm", { body: { from, to, ...body } })); refresh(); }
    catch (e) { toast.error((e as Error).message); throw e; }
  };

  return (
    <>
      <PageHeader title="일당 정산" description="금액을 확인하고 확정하세요. 세금·보험료는 계산하지 않으며, 표시 금액은 공제 전 일당입니다.">
        <Button variant="outline" asChild><a href={`/api/admin/excel/export?type=wage-summary&from=${from}&to=${to}`}><Download className="size-4" />일당 합계</a></Button>
        <Button variant="outline" asChild><a href={`/api/admin/excel/export?type=payment&from=${from}&to=${to}`}><Download className="size-4" />지급 자료(확정분)</a></Button>
        <Button disabled={!data?.summary.pendingCount} onClick={() => setConfirmAll(true)}><CheckCheck className="size-4" />기간 전체 확정</Button>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList><TabsTrigger value="day">일간</TabsTrigger><TabsTrigger value="week">주간</TabsTrigger><TabsTrigger value="month">월간</TabsTrigger><TabsTrigger value="custom">기간 지정</TabsTrigger></TabsList>
        </Tabs>
        {period === "custom" ? (
          <div className="flex items-end gap-2">
            <div className="space-y-1"><Label htmlFor="s-from" className="text-xs">시작일</Label><Input id="s-from" type="date" className="w-40" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="s-to" className="text-xs">종료일</Label><Input id="s-to" type="date" className="w-40" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></div>
          </div>
        ) : (
          <Input type="date" aria-label="기준 날짜" className="w-40" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} />
        )}
        <div className="pb-1.5 text-sm text-muted-foreground tabular-nums">{from} ~ {to}</div>
      </div>
      {invalid ? <ErrorState message="시작일이 종료일보다 늦습니다." /> : error && !data ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <LoadingState /> : data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="지급 예정액" value={formatWon(data.summary.totalWage)} hint={`${data.summary.workers}명 · ${data.summary.workDays}일`} />
            <StatCard label="확정 금액" value={formatWon(data.summary.confirmedWage)} tone="primary" />
            <StatCard label="미확정 금액" value={formatWon(data.summary.pendingWage)} tone={data.summary.pendingWage ? "warn" : undefined} />
            <StatCard label="미확정 건수" value={`${data.summary.pendingCount}건`} />
          </div>
          <Panel className="mt-4" title="근무자별 집계">
            {data.rows.length === 0 ? <EmptyState>이 기간의 근무 기록이 없습니다.</EmptyState> : (
              <Table>
                <TableHeader><TableRow><TableHead className="w-8" /><TableHead>이름</TableHead><TableHead>휴대폰 번호</TableHead><TableHead className="text-right">근무일</TableHead><TableHead className="text-right">일당 합계</TableHead><TableHead className="text-right">확정</TableHead><TableHead className="text-right">미확정</TableHead><TableHead>상태</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <Fragment key={r.worker_id}>
                      <TableRow>
                        <TableCell><Button variant="ghost" size="icon-xs" aria-expanded={open === r.worker_id} aria-label={`${r.name} 상세`} onClick={() => setOpen(open === r.worker_id ? null : r.worker_id)}>{open === r.worker_id ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button></TableCell>
                        <TableCell><Link href={`/workers/${r.worker_id}`} className="font-medium text-primary hover:underline">{r.name}</Link></TableCell>
                        <TableCell className="tabular-nums">{formatPhone(r.phone)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.work_days}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{r.total_wage.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.confirmed_wage.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.pending_wage.toLocaleString()}</TableCell>
                        <TableCell>
                          {r.open_count > 0 ? <span className="text-xs text-amber-700">퇴근 미입력 {r.open_count}건</span> : <WageBadge status={r.pending_count ? "pending" : "confirmed"} />}
                        </TableCell>
                        <TableCell className="text-right">{r.pending_count > 0 && <Button size="sm" variant="outline" onClick={() => confirm({ workerIds: [r.worker_id] }).catch(() => {})}>확정</Button>}</TableCell>
                      </TableRow>
                      {open === r.worker_id && <TableRow className="hover:bg-transparent"><TableCell colSpan={9} className="bg-muted/50 p-3"><Details key={detailVersion} from={from} to={to} workerId={r.worker_id} onConfirm={(id) => confirm({ recordIds: [id] }).catch(() => {})} onChanged={refresh} /></TableCell></TableRow>}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
        </>
      )}
      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} title="기간 전체 확정" confirmLabel="확정"
        description={`${from} ~ ${to} 미확정 ${data?.summary.pendingCount ?? 0}건, ${formatWon(data?.summary.pendingWage)}을 확정합니다. 퇴근 미입력과 0원 건은 제외됩니다.`}
        onConfirm={() => confirm({})} />
    </>
  );
}

type Detail = { record_id: string; work_date: string; clock_in_at: string | null; clock_out_at: string | null; actual_wage: number; extra_pay: number; final_wage: number; status: string };

function Details({ from, to, workerId, onConfirm, onChanged }: { from: string; to: string; workerId: string; onConfirm: (id: string) => void; onChanged: () => void }) {
  const { data, loading } = useApiData<{ rows: Detail[] }>(`/api/admin/settlements?from=${from}&to=${to}&workerId=${workerId}`);
  const [undo, setUndo] = useState<Detail | null>(null);
  if (loading && !data) return <LoadingState />;
  return (
    <>
      <Table className="bg-card">
        <TableHeader><TableRow><TableHead>근무일</TableHead><TableHead>출근</TableHead><TableHead>퇴근</TableHead><TableHead className="text-right">당일 일당</TableHead><TableHead className="text-right">추가 지급</TableHead><TableHead className="text-right">최종 일당</TableHead><TableHead>정산</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {data?.rows.map((d) => (
            <TableRow key={d.record_id}>
              <TableCell><Link className="text-primary hover:underline" href={`/attendance?date=${d.work_date}`}>{d.work_date}</Link></TableCell>
              <TableCell className="tabular-nums">{formatClock(d.clock_in_at, d.work_date)}</TableCell>
              <TableCell className="tabular-nums">{formatClock(d.clock_out_at, d.work_date)}</TableCell>
              <TableCell className="text-right tabular-nums">{d.actual_wage.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums">{d.extra_pay.toLocaleString()}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{d.final_wage.toLocaleString()}</TableCell>
              <TableCell><WageBadge status={d.status} /></TableCell>
              <TableCell className="text-right">
                {d.status === "pending"
                  ? <Button size="xs" variant="outline" onClick={() => onConfirm(d.record_id)}>확정</Button>
                  : <Button size="xs" variant="ghost" onClick={() => setUndo(d)}><Undo2 className="size-3" />확정 해제</Button>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDialog open={!!undo} onOpenChange={(o) => !o && setUndo(null)} title="확정 해제" confirmLabel="해제" reasonLabel="해제 사유" description={undo && `${undo.work_date} 일당 ${formatWon(undo.final_wage)}의 확정을 해제합니다.`}
        onConfirm={async (reason) => {
          try {
            await api("/api/admin/settlements/unconfirm", { body: { recordIds: [undo!.record_id], reason } });
            toast.success("확정을 해제했습니다.");
            onChanged();
          } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
    </>
  );
}

"use client";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, StatCard } from "@/components/admin/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiData } from "@/hooks/use-api-data";
import { formatDateTime, formatWon } from "@/lib/format";

type Dashboard = {
  date: string;
  summary: { total: number; working: number; done: number; scheduled: number; missingOut: number; totalWage: number };
  missingOut: { record_id: string; work_date: string; clock_in_at: string; worker_number: number; name: string }[];
  pending: { count: number; total: number };
  activeWorkers: number;
  recent: { id: string; event_type: string; outcome: string; reject_code: string | null; source: string; occurred_at: string; worker_number: number | null; name: string | null; device_name: string | null }[];
};

const EVENT: Record<string, string> = { clock_in: "출근", clock_out: "퇴근", manual_create: "수동 등록", correction: "기록 보정", delete: "기록 삭제" };

export default function DashboardPage() {
  const { data, error, loading, reload } = useApiData<Dashboard>("/api/admin/dashboard", { pollMs: 15000 });
  if (loading && !data) return <LoadingState />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.summary;
  return (
    <>
      <PageHeader title="대시보드" description={`${data.date} 현황 · 15초마다 자동 갱신`}>
        <Button asChild variant="outline"><Link href="/attendance">일일 출석부 열기</Link></Button>
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="오늘 출석 인원" value={`${s.total}명`} hint={s.scheduled ? `출근 전 ${s.scheduled}명 포함` : undefined} />
        <StatCard label="근무 중" value={`${s.working}명`} tone="primary" />
        <StatCard label="퇴근 완료" value={`${s.done}명`} />
        <StatCard label="오늘 일당 합계" value={formatWon(s.totalWage)} />
        <StatCard label="미확정 정산" value={formatWon(data.pending.total)} hint={`전체 기간 ${data.pending.count}건`} />
      </div>

      {data.missingOut.length > 0 && (
        <Panel className="mt-4 border-amber-300" title="퇴근 누락 확인 필요" actions={<AlertTriangle className="size-4 text-amber-600" />}>
          <p className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-800">이 근무자들은 보정 전까지 새로 출근할 수 없습니다. 해당 날짜 출석부에서 퇴근 시각을 입력해 주세요.</p>
          <Table>
            <TableHeader><TableRow><TableHead>근무일</TableHead><TableHead>번호</TableHead><TableHead>이름</TableHead><TableHead>출근 시각</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data.missingOut.map((r) => (
                <TableRow key={r.record_id}>
                  <TableCell>{r.work_date}</TableCell><TableCell className="tabular-nums">{r.worker_number}</TableCell><TableCell>{r.name}</TableCell>
                  <TableCell>{formatDateTime(r.clock_in_at)}</TableCell>
                  <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/attendance?date=${r.work_date}`}>보정하기</Link></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      <Panel className="mt-4" title="최근 출퇴근 활동">
        {data.recent.length === 0 ? <EmptyState>아직 활동이 없습니다.</EmptyState> : (
          <Table>
            <TableHeader><TableRow><TableHead>시각</TableHead><TableHead>구분</TableHead><TableHead>번호</TableHead><TableHead>이름</TableHead><TableHead>경로</TableHead><TableHead>결과</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.recent.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">{formatDateTime(e.occurred_at)}</TableCell>
                  <TableCell>{EVENT[e.event_type] ?? e.event_type}</TableCell>
                  <TableCell className="tabular-nums">{e.worker_number ?? "-"}</TableCell>
                  <TableCell>{e.name ?? "-"}</TableCell>
                  <TableCell>{e.source === "kiosk" ? (e.device_name ?? "키오스크") : "관리자"}</TableCell>
                  <TableCell>{e.outcome === "success" ? <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">성공</Badge> : <Badge variant="secondary" className="bg-red-100 text-red-800">거절</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-xs text-muted-foreground">활성 근무자 {data.activeWorkers}명</p>
    </>
  );
}

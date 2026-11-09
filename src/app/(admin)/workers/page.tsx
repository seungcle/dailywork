"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Search } from "lucide-react";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "@/components/admin/common";
import { WorkerFormDialog } from "@/components/admin/worker-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiData, useDebounced } from "@/hooks/use-api-data";
import { formatPhone } from "@/lib/format";

type Row = { id: string; worker_number: number; name: string; phone: string | null; base_daily_wage: number; is_active: boolean; last_work_date: string | null; bank_name: string | null; account_last4: string | null };
type List = { rows: Row[]; total: number; page: number; pageSize: number };

export default function WorkersPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState("worker_number");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const url = `/api/admin/workers?q=${encodeURIComponent(dq)}&status=${status}&sort=${sort}&dir=${dir}&page=${page}`;
  const { data, error, loading, reload } = useApiData<List>(url);

  const header = (key: string, label: string, right?: boolean) => (
    <TableHead className={right ? "text-right" : undefined} aria-sort={sort === key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => {
        setPage(1);
        if (sort === key) setDir(dir === "asc" ? "desc" : "asc"); else { setSort(key); setDir("asc"); }
      }}>
        {label}{sort === key && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </TableHead>
  );
  const pages = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;

  return (
    <>
      <PageHeader title="근무자 관리" description="등록 전에 먼저 검색하세요. 기존 근무자는 다시 등록하지 않아도 됩니다.">
        <Button onClick={() => setCreateOpen(true)}><Plus className="size-4" />신규 등록</Button>
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-64 flex-1 sm:max-w-sm">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" aria-label="근무자 검색" placeholder="이름, 휴대폰 번호 검색" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-28" aria-label="상태 필터"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="active">활성</SelectItem><SelectItem value="inactive">비활성</SelectItem><SelectItem value="all">전체</SelectItem></SelectContent>
        </Select>
      </div>
      <Panel>
        {error && !data ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <LoadingState /> : data && (data.rows.length === 0 ? (
          <EmptyState>{dq ? <>“{dq}” 검색 결과가 없습니다. <button type="button" className="text-primary underline" onClick={() => setCreateOpen(true)}>신규 등록하기</button></> : "등록된 근무자가 없습니다."}</EmptyState>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {header("name", "이름")}<TableHead>휴대폰 번호</TableHead>{header("base_daily_wage", "기본 일당", true)}
                  <TableHead>계좌</TableHead>{header("last_work_date", "최근 근무일")}<TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell><Link className="font-medium text-primary hover:underline" href={`/workers/${w.id}`}>{w.name}</Link></TableCell>
                    <TableCell className="tabular-nums">{formatPhone(w.phone)}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.base_daily_wage.toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{w.account_last4 ? `${w.bank_name} ••••${w.account_last4}` : <span className="text-amber-700">미등록</span>}</TableCell>
                    <TableCell className="tabular-nums">{w.last_work_date ?? "-"}</TableCell>
                    <TableCell>{w.is_active ? <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">활성</Badge> : <Badge variant="secondary">비활성</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
              <span>총 {data.total.toLocaleString()}명</span>
              <div className="flex items-center gap-2">
                <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>이전</Button>
                <span className="tabular-nums">{page} / {pages}</span>
                <Button size="xs" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>다음</Button>
              </div>
            </div>
          </>
        ))}
      </Panel>
      <WorkerFormDialog open={createOpen} onOpenChange={setCreateOpen} initial={{ name: dq && !/\d/.test(dq) ? dq : "" }} onSaved={(r) => router.push(`/workers/${r.id}`)} />
    </>
  );
}

"use client";
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel, StatCard } from "@/components/admin/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatPhone, kstDate } from "@/lib/format";

type Preview = { headers: string[]; rows: string[][]; mapping: Record<string, number>; fields: { key: string; label: string; required: boolean }[] };
type ResultRow = { row: number; status: "new" | "duplicate" | "error"; errors: string[]; reasons: string[]; name: string; phone: string | null; baseDailyWage: number | null; bankName: string | null; accountLast4: string | null };
type Validation = { results: ResultRow[]; summary: { total: number; new: number; duplicate: number; error: number } };
type Done = { created: number; updated: number; skipped: number; errors: number };

export default function ExcelPage() {
  return (
    <>
      <PageHeader title="Excel 관리" description="기존 엑셀 명부를 가져오고, 출석부와 정산 자료를 내려받습니다." />
      <ExportPanel />
      <ImportPanel />
    </>
  );
}

function ExportPanel() {
  const today = kstDate();
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const range = `from=${from}&to=${to}`;
  const items = [
    { label: "전체 근무자 명부", desc: "계좌번호 포함", href: "type=workers" },
    { label: "날짜별 출석부", desc: date, href: `type=attendance&date=${date}` },
    { label: "기간별 근무 기록", desc: `${from} ~ ${to}`, href: `type=records&${range}` },
    { label: "근무자별 일당 합계", desc: `${from} ~ ${to}`, href: `type=wage-summary&${range}` },
    { label: "지급용 정산 자료", desc: "확정 금액만, 계좌번호 포함", href: `type=payment&${range}` },
  ];
  return (
    <Panel title="내보내기">
      <div className="flex flex-wrap items-end gap-3 border-b p-4">
        <div className="space-y-1"><Label htmlFor="x-date" className="text-xs">출석부 날짜</Label><Input id="x-date" type="date" className="w-40" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="x-from" className="text-xs">기간 시작</Label><Input id="x-from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="x-to" className="text-xs">기간 종료</Label><Input id="x-to" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <ul className="divide-y">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div><div className="text-sm font-medium">{i.label}</div><div className="text-xs text-muted-foreground">{i.desc}</div></div>
            <Button size="sm" variant="outline" asChild><a href={`/api/admin/excel/export?${i.href}`}><Download className="size-3.5" />다운로드</a></Button>
          </li>
        ))}
      </ul>
      <p className="border-t bg-muted/50 px-4 py-2 text-xs text-muted-foreground">계좌번호가 포함된 파일은 다운로드 이력이 남습니다. 공유와 보관에 주의해 주세요.</p>
    </Panel>
  );
}

function ImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [validation, setValidation] = useState<Validation | null>(null);
  const [policy, setPolicy] = useState<"skip" | "update">("skip");
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "duplicate" | "error">("all");

  const reset = () => { setPreview(null); setValidation(null); setDone(null); setMapping({}); setFilter("all"); setPolicy("skip"); if (fileRef.current) fileRef.current.value = ""; };
  const shown = useMemo(() => (validation?.results ?? []).filter((r) => filter === "all" || r.status === filter), [validation, filter]);

  const upload = async (file: File) => {
    setBusy(true); setDone(null); setValidation(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const p = await api<Preview>("/api/admin/excel/import/preview", { form });
      setPreview(p); setMapping(p.mapping);
    } catch (e) { toast.error((e as Error).message); if (fileRef.current) fileRef.current.value = ""; } finally { setBusy(false); }
  };
  const validate = async () => {
    setBusy(true);
    try { setValidation(await api<Validation>("/api/admin/excel/import/validate", { body: { rows: preview!.rows, mapping } })); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try {
      setDone(await api<Done>("/api/admin/excel/import/commit", { body: { rows: preview!.rows, mapping, duplicatePolicy: policy } }));
      setPreview(null); setValidation(null);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Panel className="mt-4" title="근무자 가져오기" actions={<Button size="sm" variant="ghost" asChild><a href="/api/admin/excel/template"><Download className="size-3.5" />표준 양식</a></Button>}>
      <div className="p-4">
        {done && (
          <div className="mb-4 flex items-start gap-2 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 size-4" />
            <div>가져오기가 끝났습니다. 신규 {done.created}명, 갱신 {done.updated}명, 건너뜀 {done.skipped}명, 오류 제외 {done.errors}건</div>
          </div>
        )}
        {!preview && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed p-8 text-center hover:bg-muted/50">
            {busy ? <Loader2 className="size-7 animate-spin text-muted-foreground" /> : <FileUp className="size-7 text-muted-foreground" />}
            <span className="text-sm font-medium">.xlsx 파일 선택 (최대 4MB, 5,000행)</span>
            <span className="text-xs text-muted-foreground">파일을 읽어 미리 보여 줍니다. 확인 전에는 저장되지 않습니다.</span>
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </label>
        )}
        {preview && !validation && (
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">1. 열 연결 <span className="font-normal text-muted-foreground">({preview.rows.length.toLocaleString()}행)</span></h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {preview.fields.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs">{f.label}{f.required && " *"}</Label>
                    <Select value={mapping[f.key] === undefined ? "none" : String(mapping[f.key])} onValueChange={(v) => setMapping((m) => { const n = { ...m }; if (v === "none") delete n[f.key]; else n[f.key] = Number(v); return n; })}>
                      <SelectTrigger className="w-full" aria-label={`${f.label} 열 선택`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">사용 안 함</SelectItem>
                        {preview.headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h || `${i + 1}번째 열`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">파일 미리보기 <span className="font-normal text-muted-foreground">(처음 5행)</span></h3>
              <div className="overflow-x-auto rounded border">
                <Table>
                  <TableHeader><TableRow>{preview.headers.map((h, i) => <TableHead key={i}>{h}</TableHead>)}</TableRow></TableHeader>
                  <TableBody>{preview.rows.slice(0, 5).map((r, i) => <TableRow key={i}>{preview.headers.map((_, c) => <TableCell key={c}>{r[c]}</TableCell>)}</TableRow>)}</TableBody>
                </Table>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={reset}>취소</Button>
              <Button disabled={busy || mapping.name === undefined} onClick={validate}>{busy && <Loader2 className="size-4 animate-spin" />}검사하기</Button>
            </div>
          </div>
        )}
        {preview && validation && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">2. 검사 결과 확인</h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="전체" value={`${validation.summary.total}행`} />
              <StatCard label="신규 등록" value={`${validation.summary.new}명`} tone="primary" />
              <StatCard label="기존 근무자와 중복" value={`${validation.summary.duplicate}건`} tone={validation.summary.duplicate ? "warn" : undefined} />
              <StatCard label="오류 (제외됨)" value={`${validation.summary.error}건`} tone={validation.summary.error ? "warn" : undefined} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1">
                {(["all", "new", "duplicate", "error"] as const).map((k) => (
                  <Button key={k} size="sm" variant={filter === k ? "secondary" : "ghost"} onClick={() => setFilter(k)}>{{ all: "전체", new: "신규", duplicate: "중복", error: "오류" }[k]}</Button>
                ))}
              </div>
              {validation.summary.duplicate > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span>중복 처리</span>
                  <Select value={policy} onValueChange={(v) => setPolicy(v as "skip" | "update")}>
                    <SelectTrigger className="w-56" aria-label="중복 처리 방법"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="skip">건너뛰기 (기존 정보 유지)</SelectItem><SelectItem value="update">파일 값으로 기존 정보 갱신</SelectItem></SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="max-h-96 overflow-auto rounded border">
              <Table>
                <TableHeader><TableRow><TableHead>행</TableHead><TableHead>결과</TableHead><TableHead>이름</TableHead><TableHead>전화번호</TableHead><TableHead className="text-right">일당</TableHead><TableHead>계좌</TableHead><TableHead>내용</TableHead></TableRow></TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.row}>
                      <TableCell className="tabular-nums">{r.row}</TableCell>
                      <TableCell>{r.status === "new" ? <Badge variant="secondary" className="bg-blue-100 text-blue-800">신규</Badge> : r.status === "duplicate" ? <Badge variant="secondary" className="bg-amber-100 text-amber-800">중복</Badge> : <Badge variant="secondary" className="bg-red-100 text-red-800">오류</Badge>}</TableCell>
                      <TableCell className="font-medium">{r.name || "-"}</TableCell>
                      <TableCell className="tabular-nums">{formatPhone(r.phone)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.baseDailyWage?.toLocaleString() ?? "-"}</TableCell>
                      <TableCell>{r.accountLast4 ? `${r.bankName ?? ""} ••••${r.accountLast4}` : "-"}</TableCell>
                      <TableCell className="text-xs whitespace-normal">{r.status === "error" ? <span className="text-destructive">{r.errors.join(" ")}</span> : r.status === "duplicate" ? <>{r.reasons.join(", ")}</> : ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setValidation(null)}>열 연결로 돌아가기</Button>
              <Button variant="outline" disabled={busy} onClick={reset}>취소</Button>
              <Button disabled={busy || (validation.summary.new === 0 && (policy === "skip" || validation.summary.duplicate === 0))} onClick={commit}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {validation.summary.new}명 등록{policy === "update" && validation.summary.duplicate ? ` · ${validation.summary.duplicate}명 갱신` : ""}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

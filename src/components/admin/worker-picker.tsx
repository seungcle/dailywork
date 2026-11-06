"use client";
import { useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useApiData, useDebounced } from "@/hooks/use-api-data";
import { formatPhone } from "@/lib/format";

export type PickedWorker = { id: string; worker_number: number; name: string; phone: string | null };

/** 기존 근무자를 검색해 여러 명 선택한다. */
export function WorkerPicker({ selected, onChange }: { selected: PickedWorker[]; onChange: (w: PickedWorker[]) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, loading } = useApiData<{ rows: PickedWorker[] }>(`/api/admin/workers?status=active&pageSize=30&q=${encodeURIComponent(dq)}`);
  const isSel = (id: string) => selected.some((s) => s.id === id);
  const toggle = (w: PickedWorker) => onChange(isSel(w.id) ? selected.filter((s) => s.id !== w.id) : [...selected, w]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input autoFocus className="pl-8" placeholder="이름, 번호, 전화번호로 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="max-h-56 overflow-y-auto rounded border">
        {!loading && data?.rows.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</div>}
        {data?.rows.map((w) => (
          <label key={w.id} className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted">
            <Checkbox checked={isSel(w.id)} onCheckedChange={() => toggle(w)} />
            <span className="w-14 text-muted-foreground tabular-nums">{w.worker_number}</span>
            <span className="flex-1 font-medium">{w.name}</span>
            <span className="text-xs text-muted-foreground">{formatPhone(w.phone)}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((w) => (
            <Badge key={w.id} variant="secondary" className="gap-1">
              {w.name}
              <button type="button" aria-label={`${w.name} 선택 해제`} onClick={() => toggle(w)}><X className="size-3" /></button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

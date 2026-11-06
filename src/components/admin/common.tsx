"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warn" | "primary" }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "warn" && "text-amber-600", tone === "primary" && "text-primary")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border bg-card", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-12 text-center text-sm text-muted-foreground">{children}</div>;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-sm text-destructive">
      <div>{message}</div>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>다시 시도</Button>}
    </div>
  );
}
export function LoadingState() {
  return <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
}

const ATT: Record<string, { label: string; className: string }> = {
  scheduled: { label: "출근 전", className: "bg-slate-100 text-slate-600" },
  working: { label: "근무 중", className: "bg-blue-100 text-blue-800" },
  done: { label: "퇴근 완료", className: "bg-emerald-100 text-emerald-800" },
  missing_out: { label: "퇴근 누락", className: "bg-amber-100 text-amber-800" },
};
export function AttendanceBadge({ status }: { status: string }) {
  const s = ATT[status] ?? ATT.scheduled;
  return <Badge variant="secondary" className={s.className}>{s.label}</Badge>;
}
export function WageBadge({ status }: { status: string }) {
  return status === "confirmed"
    ? <Badge variant="secondary" className="bg-primary/10 text-primary">확정</Badge>
    : <Badge variant="secondary" className="bg-slate-100 text-slate-600">미확정</Badge>;
}

/** 확인 대화상자. reasonLabel을 주면 사유를 필수로 받는다. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "확인", destructive, reasonLabel, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel?: string;
  destructive?: boolean; reasonLabel?: string; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = !!reasonLabel && !reason.trim();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) setReason(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        {reasonLabel && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">{reasonLabel}</Label>
            <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>취소</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={busy || blocked} onClick={async () => {
            setBusy(true);
            try { await onConfirm(reason.trim()); setReason(""); onOpenChange(false); } finally { setBusy(false); }
          }}>{busy && <Loader2 className="size-4 animate-spin" />}{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

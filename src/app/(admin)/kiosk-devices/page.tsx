"use client";
import { useState } from "react";
import { KeyRound, Loader2, Plus, Unplug } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Panel } from "@/components/admin/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useApiData } from "@/hooks/use-api-data";
import { api } from "@/lib/api";
import { formatDateTime, pairingLink } from "@/lib/format";

type Device = { id: string; name: string; created_at: string; paired_at: string | null; last_seen_at: string | null; status: "connected" | "waiting" | "revoked" };
type Issued = { name: string; code: string; expiresAt: string };

const STATUS = {
  connected: { label: "연결됨", className: "bg-emerald-100 text-emerald-800" },
  waiting: { label: "연결 대기", className: "bg-blue-100 text-blue-800" },
  revoked: { label: "해제됨", className: "bg-slate-200 text-slate-600" },
};

export default function KioskDevicesPage() {
  const { data, error, loading, reload } = useApiData<{ devices: Device[] }>("/api/admin/kiosk-devices", { pollMs: 15000 });
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [reissuing, setReissuing] = useState<Device | null>(null);

  return (
    <>
      <PageHeader title="키오스크 관리" description="등록한 태블릿에서만 출퇴근 화면과 API를 사용할 수 있습니다. QR을 찍으면 바로 연결됩니다.">
        <Button onClick={() => { setName(""); setAddOpen(true); }}><Plus className="size-4" />태블릿 등록</Button>
      </PageHeader>
      <Panel>
        {error && !data ? <ErrorState message={error} onRetry={reload} /> : loading && !data ? <LoadingState /> : data?.devices.length === 0 ? (
          <EmptyState>등록된 태블릿이 없습니다. 태블릿 등록을 눌러 연결 QR을 만드세요.</EmptyState>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>장치 이름</TableHead><TableHead>상태</TableHead><TableHead>연결일</TableHead><TableHead>최근 사용</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data?.devices.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell><Badge variant="secondary" className={STATUS[d.status].className}>{STATUS[d.status].label}</Badge></TableCell>
                  <TableCell className="tabular-nums">{formatDateTime(d.paired_at)}</TableCell>
                  <TableCell className="tabular-nums">{formatDateTime(d.last_seen_at)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Button size="sm" variant="outline" onClick={() => setReissuing(d)}><KeyRound className="size-3.5" />새 QR 발급</Button>
                    {d.status !== "revoked" && <Button size="sm" variant="ghost" className="ml-1 text-destructive" onClick={() => setRevoking(d)}><Unplug className="size-3.5" />연결 해제</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Dialog open={addOpen} onOpenChange={(o) => !busy && setAddOpen(o)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>태블릿 등록</DialogTitle><DialogDescription>관리자가 알아볼 수 있는 이름을 정해 주세요.</DialogDescription></DialogHeader>
          <form id="add-device" onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await api<{ code: string; expiresAt: string }>("/api/admin/kiosk-devices", { body: { name } });
              setAddOpen(false);
              setIssued({ name, ...r });
              void reload();
            } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
          }}>
            <Label htmlFor="device-name" className="mb-1.5">장치 이름</Label>
            <Input id="device-name" autoFocus required placeholder="예: 정문 태블릿" value={name} onChange={(e) => setName(e.target.value)} />
          </form>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setAddOpen(false)}>취소</Button>
            <Button type="submit" form="add-device" disabled={busy || !name.trim()}>{busy && <Loader2 className="size-4 animate-spin" />}QR 만들기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{issued?.name} 연결</DialogTitle>
            <DialogDescription>태블릿 카메라로 QR을 찍고 열리는 화면에서 연결하기를 누르세요.</DialogDescription>
          </DialogHeader>
          {issued && (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-md border bg-white p-3" data-testid="pairing-qr">
                <QRCodeSVG value={pairingLink(window.location.origin, issued.code)} size={240} level="M" marginSize={2} title="태블릿 연결 QR" />
              </div>
              <p className="text-sm text-muted-foreground">{formatDateTime(issued.expiresAt)}까지 유효하며 한 번만 쓸 수 있습니다.</p>
            </div>
          )}
          <details className="rounded border px-3 py-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">카메라를 쓸 수 없다면 코드 직접 입력</summary>
            <p className="mt-2 text-muted-foreground">태블릿에서 <code className="rounded bg-muted px-1 text-foreground">/kiosk/setup</code>에 접속해 아래 코드를 입력하세요.</p>
            <div className="mt-2 rounded bg-muted py-2 text-center font-mono text-2xl font-bold tracking-widest text-primary">{issued?.code}</div>
          </details>
          <DialogFooter><Button onClick={() => setIssued(null)}>닫기</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!reissuing} onOpenChange={(o) => !o && setReissuing(null)} title="새 연결 QR 발급" confirmLabel="발급"
        description={`${reissuing?.name}의 기존 연결을 끊고 새 QR을 발급합니다. 태블릿 교체나 재연결이 필요할 때 사용하세요.`}
        onConfirm={async () => {
          try {
            const r = await api<{ code: string; expiresAt: string }>(`/api/admin/kiosk-devices/${reissuing!.id}/code`, { method: "POST" });
            setIssued({ name: reissuing!.name, ...r });
            void reload();
          } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
      <ConfirmDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} title="연결 해제" destructive confirmLabel="연결 해제"
        description={`${revoking?.name}에서 즉시 출퇴근을 할 수 없게 됩니다. 분실한 태블릿은 바로 해제해 주세요.`}
        onConfirm={async () => {
          try {
            await api(`/api/admin/kiosk-devices/${revoking!.id}`, { method: "DELETE" });
            toast.success("연결을 해제했습니다.");
            void reload();
          } catch (e) { toast.error((e as Error).message); throw e; }
        }} />
    </>
  );
}

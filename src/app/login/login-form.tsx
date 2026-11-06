"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setError(null);
      try {
        await api("/api/auth/login", { body: { username, password } });
        window.location.replace("/dashboard");
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
      }
    }}>
      <div className="space-y-1.5">
        <Label htmlFor="username">아이디</Label>
        <Input id="username" autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">비밀번호</Label>
        <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}로그인</Button>
    </form>
  );
}

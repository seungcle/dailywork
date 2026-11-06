import { redirect } from "next/navigation";
import { currentAdmin } from "@/server/pageAuth";
import { LoginForm } from "./login-form";

export const metadata = { title: "로그인 | DailyWork" };

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/dashboard");
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-md border bg-card p-7 shadow-xs">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-primary">DailyWork</div>
          <p className="mt-1 text-sm text-muted-foreground">일용직 인력 관리 시스템</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

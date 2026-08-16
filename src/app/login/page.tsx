import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { loginAction } from "@/server/actions/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Anmelden" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-base font-bold text-white">
            E
          </div>
          <span className="text-lg font-semibold tracking-tight">Elia ERP</span>
        </div>
        <div className="rounded-lg border border-border bg-surface p-6">
          <h1 className="mb-4 text-base font-semibold">Anmelden</h1>
          <LoginForm action={loginAction} />
        </div>
        <p className="mt-4 text-center text-xs text-ink-tertiary">
          Sammelkarten-Großhandel · Einkauf · Lager · Verkauf
        </p>
      </div>
    </main>
  );
}

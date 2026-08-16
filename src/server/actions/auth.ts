"use server";

import { redirect } from "next/navigation";
import { login, logout } from "../auth";
import { toUserMessage } from "../errors";
import type { ActionState } from "@/components/form";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  try {
    await login(email, password);
  } catch (err) {
    return { error: toUserMessage(err) };
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/format";
import { buttonClass } from "./ui";

// ============================================================
// Formular-Bausteine für Server Actions.
// Standardvertrag: Action gibt { ok?: true; error?: string;
// redirect?: string } zurück; Fehler werden verständlich angezeigt.
// ============================================================

export type ActionState = { ok?: boolean; error?: string; redirect?: string } | null;
export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && state.redirect) router.push(state.redirect);
    if (state?.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, router, resetOnSuccess]);

  return (
    <form ref={formRef} action={formAction} className={className}>
      {state?.error && (
        <div className="mb-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      )}
      {children}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  confirmMessage,
  className,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  confirmMessage?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      className={cn(buttonClass(variant, size), pending && "cursor-wait opacity-60", className)}
    >
      {pending ? "Bitte warten…" : children}
    </button>
  );
}

const inputClass =
  "w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink " +
  "placeholder:text-ink-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 " +
  "disabled:bg-canvas disabled:text-ink-tertiary";

export function Field({
  label,
  children,
  hint,
  required,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={cn("block text-sm", className)}>
      <span className="mb-1 block font-medium text-ink-secondary">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-tertiary">{hint}</span>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputClass, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputClass, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputClass, "min-h-[70px]", props.className)} />;
}

/** Euro-Eingabe: zeigt/parst „123,45“, überträgt Cents als Hidden-Feld. */
export function MoneyInput({
  name,
  defaultCents,
  required,
  placeholder,
}: {
  name: string;
  defaultCents?: number | null;
  required?: boolean;
  placeholder?: string;
}) {
  const [display, setDisplay] = useState(
    defaultCents !== undefined && defaultCents !== null ? (defaultCents / 100).toFixed(2).replace(".", ",") : ""
  );
  const cents = (() => {
    if (!display.trim()) return "";
    const normalized = display.replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    return isFinite(value) ? String(Math.round(value * 100)) : "";
  })();
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        value={display}
        required={required}
        placeholder={placeholder ?? "0,00"}
        onChange={(e) => setDisplay(e.target.value)}
        className={cn(inputClass, "pr-7")}
      />
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-ink-tertiary">
        €
      </span>
      <input type="hidden" name={name} value={cents} />
    </div>
  );
}

/** Einzelner Action-Button (z.B. „Als zugestellt markieren“) als Mini-Form. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  size = "sm",
  confirmMessage,
  hiddenFields,
}: {
  action: FormAction;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  confirmMessage?: string;
  hiddenFields?: Record<string, string>;
}) {
  return (
    <ActionForm action={action} className="inline-block">
      {hiddenFields &&
        Object.entries(hiddenFields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton variant={variant} size={size} confirmMessage={confirmMessage}>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

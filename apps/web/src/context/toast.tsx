import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { normalizeToastMessage } from "../lib/toastMessage.js";

type ToastKind = "success" | "error" | "info";

type ToastInput = {
  kind: ToastKind;
  title: string;
  message: string;
  hint?: string;
  dedupKey?: string;
};

type Toast = ToastInput & {
  id: string;
  createdAt: number;
  stage: "entering" | "visible" | "exiting";
};

type ToastContextValue = {
  pushToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number[]>());

  useEffect(() => {
    return () => {
      for (const timeoutIds of timers.current.values()) {
        timeoutIds.forEach((id) => window.clearTimeout(id));
      }
      timers.current.clear();
    };
  }, []);

  const trackTimer = (id: string, timeoutId: number) => {
    const current = timers.current.get(id);
    if (current) {
      current.push(timeoutId);
      return;
    }
    timers.current.set(id, [timeoutId]);
  };

  const clearToastTimers = (id: string) => {
    const timeoutIds = timers.current.get(id);
    if (!timeoutIds) return;
    timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timers.current.delete(id);
  };

  const value = useMemo<ToastContextValue>(() => {
    return {
      pushToast(input) {
        setToasts((current) => {
          if (input.dedupKey && current.some((item) => item.dedupKey === input.dedupKey)) {
            return current;
          }
          const next: Toast = {
            ...input,
            message: normalizeToastMessage(input.message),
            id: crypto.randomUUID(),
            createdAt: Date.now(),
            stage: "entering",
          };
          const showTimer = window.setTimeout(() => {
            setToasts((state) => state.map((item) => (item.id === next.id ? { ...item, stage: "visible" } : item)));
          }, 20);
          const exitTimer = window.setTimeout(() => {
            setToasts((state) => state.map((item) => (item.id === next.id ? { ...item, stage: "exiting" } : item)));
          }, 5_000);
          const removeTimer = window.setTimeout(() => {
            clearToastTimers(next.id);
            setToasts((state) => state.filter((item) => item.id !== next.id));
          }, 5_420);
          trackTimer(next.id, showTimer);
          trackTimer(next.id, exitTimer);
          trackTimer(next.id, removeTimer);
          return [...current, next];
        });
      }
    };
  }, []);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 bottom-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={clsx(
              "min-w-[260px] rounded-lg border bg-[var(--bg-soft)] p-3 transition-[transform,opacity] duration-[420ms] ease-[var(--ease)] motion-reduce:transition-none",
              toast.stage === "entering" && "translate-x-[calc(100%+1rem)] opacity-0",
              toast.stage === "visible" && "translate-x-0 opacity-100",
              toast.stage === "exiting" && "translate-x-[calc(100%+1rem)] opacity-0",
              {
                "border-[var(--success)]": toast.kind === "success",
                "border-[var(--error)]": toast.kind === "error",
                "border-[var(--accent)]": toast.kind === "info",
              },
            )}
          >
            <div className="mb-1 font-extrabold">{toast.title}</div>
            <div className="text-[0.88rem] text-[var(--fg-muted)]">{toast.message}</div>
            {toast.hint ? <div className="mt-1 text-[0.8rem] text-[var(--fg-dim)]">{toast.hint}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}

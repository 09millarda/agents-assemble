import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
}

const ToastContext = createContext<{ notify: (title: string, description?: string) => void }>({
  notify: () => {},
});

export function useToast(): { notify: (title: string, description?: string) => void } {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const notify = useCallback((title: string, description?: string) => {
    const id = Date.now() + Math.random();
    setToasts((previous) => [...previous, { id, title, description }]);
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);
  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 grid gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} role="status" className={cn("pointer-events-auto w-80 rounded-2xl border border-border bg-card p-4 shadow-[0_18px_45px_rgba(16,26,46,0.16)]")}>
            <p className="text-sm font-medium">{toast.title}</p>
            {toast.description ? <p className="mt-1 text-xs text-muted-foreground">{toast.description}</p> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

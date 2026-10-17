export type ToastTheme = "normal" | "info" | "success" | "warning" | "danger";

export interface ToastOptions {
  name: string;
  title?: string;
  content?: string;
  theme?: ToastTheme;
  /** Milliseconds before the toast hides itself; `false` keeps it open. */
  autoHiding?: number | false;
  isClosable?: boolean;
}

export interface ToastEntry extends ToastOptions {
  addedAt: number;
}

type Listener = () => void;

/**
 * UIX-709: the application toaster without Gravity UI. A tiny external store:
 * `add` replaces a toast with the same name, `remove` drops it, and
 * `AppToaster` renders the list through useSyncExternalStore.
 */
export class Toaster {
  private toasts: readonly ToastEntry[] = [];
  private readonly listeners = new Set<Listener>();

  add(options: ToastOptions) {
    this.toasts = [
      ...this.toasts.filter(({ name }) => name !== options.name),
      { ...options, addedAt: Date.now() },
    ];
    this.emit();
  }

  remove(name: string) {
    if (!this.has(name)) return;
    this.toasts = this.toasts.filter((toast) => toast.name !== name);
    this.emit();
  }

  removeAll() {
    if (this.toasts.length === 0) return;
    this.toasts = [];
    this.emit();
  }

  has(name: string) {
    return this.toasts.some((toast) => toast.name === name);
  }

  getSnapshot = () => this.toasts;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

export const appToaster = new Toaster();

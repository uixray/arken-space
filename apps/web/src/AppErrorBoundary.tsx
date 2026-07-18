import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@gravity-ui/uikit";

type State = { error: Error | null; code: string };

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null, code: "" };

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      code: `UI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("app.render_failed", {
      code: this.state.code,
      error,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-fatal-error" role="alert">
        <h1>Интерфейс временно остановлен</h1>
        <p>
          Код ошибки для баг-репорта: <code>{this.state.code}</code>
        </p>
        <div className="inline-fields">
          <Button
            view="action"
            onClick={() => this.setState({ error: null, code: "" })}
          >
            Попробовать восстановить
          </Button>
          <Button onClick={() => window.location.reload()}>
            Перезагрузить страницу
          </Button>
        </div>
      </main>
    );
  }
}

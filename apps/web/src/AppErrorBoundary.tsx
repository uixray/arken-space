import { Component, createRef, type ReactNode } from "react";
import { Button } from "./design-system/Button";
import { reportRenderFailure } from "./app-error-report";

type State = { error: Error | null; code: string };

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null, code: "" };
  private heading = createRef<HTMLHeadingElement>();

  static getDerivedStateFromError(error: Error): State {
    return {
      error,
      code: `UI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    };
  }

  componentDidCatch(error: Error) {
    this.heading.current?.focus();
    console.error("app.render_failed", { code: this.state.code });
    reportRenderFailure(this.state.code, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-fatal-error" role="alert">
        <h1 ref={this.heading} tabIndex={-1}>Интерфейс временно остановлен</h1>
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
          <a href="/account">Вернуться к моим кампаниям</a>
        </div>
      </main>
    );
  }
}

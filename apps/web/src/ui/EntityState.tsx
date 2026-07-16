import type { ReactNode } from "react";
import { Button, Loader } from "@gravity-ui/uikit";

interface StateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

function StateLayout({ title, description, action }: StateProps) {
  return (
    <div className="arken-state">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function EmptyState(props: StateProps) {
  return <StateLayout {...props} />;
}

export function LoadingState({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="arken-state arken-state--loading" role="status">
      <Loader size="m" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "Не удалось загрузить данные",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <StateLayout
      title={title}
      description={description}
      action={
        onRetry ? (
          <Button view="outlined" onClick={onRetry}>
            Повторить
          </Button>
        ) : undefined
      }
    />
  );
}

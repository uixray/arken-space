import { Button, Icon } from "@gravity-ui/uikit";
import { ArrowRight, TrashBin, Xmark } from "@gravity-ui/icons";

export function SelectionActions({
  count,
  onMove,
  onDelete,
  onClear,
}: {
  count: number;
  onMove: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (count < 1) return null;
  return (
    <div
      className="arken-selection-actions"
      role="toolbar"
      aria-label="Действия с выбранными объектами"
    >
      <strong>Выбрано: {count}</strong>
      <Button view="normal" onClick={onMove}>
        <Icon data={ArrowRight} size={16} />
        Переместить
      </Button>
      <Button view="outlined-danger" onClick={onDelete}>
        <Icon data={TrashBin} size={16} />
        Удалить
      </Button>
      <Button view="flat" aria-label="Снять выделение" onClick={onClear}>
        <Icon data={Xmark} size={16} />
      </Button>
    </div>
  );
}

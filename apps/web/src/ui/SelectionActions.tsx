import { Button } from "@gravity-ui/uikit";
import { AppIcon } from "./AppIcon";
import { CloseIcon, DeleteIcon, MoveSelectionIcon } from "./icons";

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
      <Button view="normal" onClick={onMove}>
        <AppIcon icon={MoveSelectionIcon} />
        Переместить
      </Button>
      <Button view="outlined-danger" onClick={onDelete}>
        <AppIcon icon={DeleteIcon} />
        Удалить
      </Button>
      <Button view="flat" aria-label="Снять выделение" onClick={onClear}>
        <AppIcon icon={CloseIcon} />
      </Button>
    </div>
  );
}

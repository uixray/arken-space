import { useState } from "react";
import {
  Button,
  Checkbox,
  Icon,
  Label,
  Popup,
  Select,
  Switch,
  TextArea,
  TextInput,
} from "@gravity-ui/uikit";
import { Gear, Plus, TrashBin } from "@gravity-ui/icons";
import { ArkenDialog } from "./ArkenDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { notify } from "./notifications";

export function GravityFoundationPreview() {
  const [formOpen, setFormOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupAnchor, setPopupAnchor] = useState<HTMLButtonElement | null>(
    null,
  );

  return (
    <main className="gravity-preview">
      <header className="gravity-preview__header">
        <div>
          <span className="gravity-preview__eyebrow">
            Arken Space · UI foundation
          </span>
          <h1>Рабочая оболочка Gravity UI</h1>
        </div>
        <Label theme="success" size="m">
          Изолированная ветка
        </Label>
      </header>

      <section className="gravity-preview__section">
        <div className="gravity-preview__section-heading">
          <div>
            <h2>Действия</h2>
            <p>Единая иерархия обычных, основных и опасных операций.</p>
          </div>
        </div>
        <div className="gravity-preview__actions">
          <Button view="action" size="l" onClick={() => setFormOpen(true)}>
            <Icon data={Plus} size={16} />
            Создать сцену
          </Button>
          <Button
            ref={setPopupAnchor}
            view="normal"
            size="l"
            onClick={() => setPopupOpen((value) => !value)}
          >
            <Icon data={Gear} size={16} />
            Параметры
          </Button>
          <Popup
            open={popupOpen}
            onOpenChange={setPopupOpen}
            anchorElement={popupAnchor}
            placement="bottom-start"
          >
            <div className="gravity-preview__popup">
              <Switch defaultChecked>Показывать слой мастера</Switch>
              <Checkbox defaultChecked>Привязка к сетке</Checkbox>
            </div>
          </Popup>
          <Button
            view="outlined-danger"
            size="l"
            onClick={() => setConfirmOpen(true)}
          >
            <Icon data={TrashBin} size={16} />
            Удалить
          </Button>
          <Button
            view="normal"
            size="l"
            onClick={() =>
              notify({
                title: "Изменения сохранены",
                message: "Сцена синхронизирована для всех участников.",
                tone: "success",
              })
            }
          >
            Показать уведомление
          </Button>
        </div>
      </section>

      <section className="gravity-preview__section gravity-preview__form-grid">
        <div className="gravity-preview__section-heading">
          <div>
            <h2>Поля и состояния</h2>
            <p>Базовые элементы будущих форм токенов, сцен и музыки.</p>
          </div>
        </div>
        <div className="gravity-preview__fields">
          <TextInput size="l" label="Название" defaultValue="Первая сцена" />
          <Select
            size="l"
            label="Слой"
            defaultValue={["players"]}
            options={[
              { value: "map", content: "Карта" },
              { value: "gm", content: "Мастер" },
              { value: "players", content: "Игроки" },
            ]}
          />
          <TextArea
            size="l"
            minRows={4}
            placeholder="Описание или заметка для мастера"
          />
        </div>
      </section>

      <ArkenDialog
        open={formOpen}
        title="Новая сцена"
        onClose={() => setFormOpen(false)}
        onApply={() => {
          setFormOpen(false);
          notify({ title: "Сцена создана", tone: "success" });
        }}
      >
        <div className="gravity-preview__dialog-fields">
          <TextInput size="l" label="Название сцены" autoFocus />
          <Select
            size="l"
            label="Доступ"
            defaultValue={["private"]}
            options={[
              { value: "private", content: "Только мастер" },
              { value: "published", content: "Показать игрокам" },
            ]}
          />
        </div>
      </ArkenDialog>

      <ConfirmDialog
        open={confirmOpen}
        title="Удалить сцену?"
        message="Сцена и размещённые на ней объекты будут удалены. Это действие нельзя отменить."
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          notify({ title: "Сцена удалена", tone: "warning" });
        }}
      />
    </main>
  );
}

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Input } from "./Input";
import { TextArea } from "./TextArea";
import { Search, User, Key, Hash } from "lucide-react";

const meta: Meta<typeof Input> = {
  title: "Design System/Input & TextArea",
  component: Input,
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Inputs: Story = {
  render: () => {
    const [searchVal, setSearchVal] = useState("Искать заклинание");
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 420 }}>
        <h3>Поля ввода: Размеры и состояния</h3>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
            Размер M (32px, основной)
          </label>
          <Input placeholder="Имя персонажа..." defaultValue="Варис" />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
            Слот иконки слева (Start Slot)
          </label>
          <Input
            placeholder="Логин мастера..."
            startSlot={<User size={14} />}
            defaultValue="GameMaster_99"
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
            Поиск с кнопкой быстрой очистки (hasClear)
          </label>
          <Input
            value={searchVal}
            onChange={(e) => setSearchVal(e.target.value)}
            hasClear
            onClear={() => setSearchVal("")}
            startSlot={<Search size={14} />}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
            Числовое поле с шагом (Step / Min / Max)
          </label>
          <Input
            type="number"
            min={1}
            max={100}
            defaultValue={15}
            startSlot={<Hash size={14} />}
          />
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
            Состояние ошибки (Invalid)
          </label>
          <Input
            placeholder="Секретный ключ..."
            startSlot={<Key size={14} />}
            defaultValue="wrong-key"
            validationState="invalid"
          />
          <span style={{ fontSize: 10, color: "var(--color-danger)", marginTop: 4, display: "block" }}>
            Неверный ключ кампании
          </span>
        </div>
        <div>
          <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
            Отключенное поле (Disabled)
          </label>
          <Input placeholder="Недоступно для редактирования" disabled defaultValue="Только чтение" />
        </div>
      </div>
    );
  },
};

export const TextAreas: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 420 }}>
      <h3>Многострочные поля ввода (TextArea)</h3>
      <div>
        <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
          Описание персонажа или локации
        </label>
        <TextArea
          placeholder="Напишите краткую биографию или предысторию персонажа..."
          defaultValue="Странник из забытых земель, ищущий древние реликвии..."
          rows={4}
        />
      </div>
      <div>
        <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
          Многострочное поле с ошибкой (Invalid)
        </label>
        <TextArea
          defaultValue="Превышен лимит символов описания"
          validationState="invalid"
          rows={3}
        />
      </div>
      <div>
        <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "var(--color-text-muted)" }}>
          Отключенное многострочное поле (Disabled)
        </label>
        <TextArea
          defaultValue="Заметки мастера скрыты для игроков."
          disabled
          rows={3}
        />
      </div>
    </div>
  ),
};

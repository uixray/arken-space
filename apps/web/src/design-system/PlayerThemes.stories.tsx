import { useId, useLayoutEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, ThemeProvider } from "@gravity-ui/uikit";
import { FormInput, FormSelect, FormTextArea } from "../ui/GravityFormControls";
import {
  PLAYER_THEMES,
  resolvePlayerThemeId,
  type PlayerThemeId,
} from "./player-themes";
import "./player-themes.generated.css";
import "./player-theme-gravity.css";

/** Real production controls, not a second component implementation.
 * Story state never writes preferences or claims that a profile was saved. */
function PlayerThemeControls() {
  const [themeId, setThemeId] = useState<PlayerThemeId | "system">("system");
  const [name, setName] = useState("");
  const resourceReasonId = useId();
  const theme = PLAYER_THEMES.find((candidate) => candidate.id === themeId);
  const duplicate = name.trim() === "Запас";

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-player-theme");
    if (themeId === "system") root.removeAttribute("data-player-theme");
    else root.setAttribute("data-player-theme", themeId);
    return () => {
      if (previous === null) root.removeAttribute("data-player-theme");
      else root.setAttribute("data-player-theme", previous);
    };
  }, [themeId]);

  return (
    <ThemeProvider theme={theme?.colorScheme ?? "dark"} lang="ru">
      <main
        style={{
          background: "var(--color-canvas)",
          color: "var(--color-text)",
          padding: "var(--space-xl)",
          maxWidth: 720,
        }}
      >
        <h1>Тема и состояния полей</h1>
        <label>
          Тема
          <FormSelect
            aria-label="Тема"
            value={themeId}
            onChange={(event) =>
              setThemeId(
                resolvePlayerThemeId({ selectedThemeId: event.target.value }),
              )
            }
          >
            <option value="system">Системная</option>
            {PLAYER_THEMES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </FormSelect>
        </label>
        <section
          style={{
            background: "var(--color-surface)",
            padding: "var(--space-lg)",
            marginTop: "var(--space-xl)",
          }}
        >
          <h2>Персонаж</h2>
          <label>
            Имя
            <FormInput aria-label="Имя" defaultValue="Астра" />
          </label>
          <label>
            Предыстория
            <FormTextArea
              aria-label="Предыстория"
              defaultValue="Следопыт северного леса."
            />
          </label>
          <label>
            Владелец
            <FormInput aria-label="Владелец" value="Игрок" readOnly />
          </label>
          <label>
            Ресурс
            <FormInput
              aria-label="Ресурс"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={duplicate}
              aria-describedby={resourceReasonId}
            />
          </label>
          <p
            id={resourceReasonId}
            style={{
              color: duplicate
                ? "var(--state-error-ink, var(--color-danger))"
                : "var(--color-text-muted)",
            }}
          >
            {duplicate
              ? "Ресурс «Запас» уже существует."
              : !name.trim()
                ? "Введите название ресурса."
                : "Название доступно."}
          </p>
          <div
            style={{
              display: "flex",
              gap: "var(--space-sm)",
              flexWrap: "wrap",
            }}
          >
            <Button
              view="action"
              disabled={!name.trim() || duplicate}
              aria-describedby={resourceReasonId}
            >
              Добавить
            </Button>
            <Button view="outlined" onClick={() => setName("")}>
              Отмена
            </Button>
            <Button view="action" loading>
              Сохранение
            </Button>
          </div>
          <p>
            <FormInput type="checkbox" defaultChecked>
              Показывать подпись персонажа
            </FormInput>
          </p>
          <label>
            Заметка только для чтения
            <FormTextArea
              aria-label="Заметка только для чтения"
              value="Указание мастера"
              readOnly
            />
          </label>
          <label>
            Недоступное поле
            <FormInput
              aria-label="Недоступное поле"
              value="Недоступно"
              readOnly
              disabled
            />
          </label>
          <label>
            Недоступная заметка
            <FormTextArea
              aria-label="Недоступная заметка"
              value="Недоступно"
              readOnly
              disabled
            />
          </label>
        </section>
      </main>
    </ThemeProvider>
  );
}

const meta = {
  title: "Design system/Player themes",
  component: PlayerThemeControls,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PlayerThemeControls>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Controls: Story = {};

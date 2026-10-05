// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

afterEach(cleanup);

describe("Select Component", () => {
  it("renders trigger and displays selected value", () => {
    render(
      <Select
        aria-label="Слой"
        defaultValue="map"
        options={[
          { value: "map", label: "Карта" },
          { value: "players", label: "Игроки" },
        ]}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Слой" });
    expect(trigger).toHaveTextContent("Карта");
  });

  it("opens popup on click and updates selection", async () => {
    const user = userEvent.setup();
    const handleUpdate = vi.fn();

    render(
      <Select
        aria-label="Режим"
        defaultValue="easy"
        onUpdate={handleUpdate}
        options={[
          { value: "easy", label: "Легкий" },
          { value: "hard", label: "Сложный" },
        ]}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Режим" });
    await user.click(trigger);

    const hardOption = screen.getByRole("option", { name: "Сложный" });
    await user.click(hardOption);

    expect(trigger).toHaveTextContent("Сложный");
    expect(handleUpdate).toHaveBeenCalledWith(["hard"]);
  });

  it("supports native <option> children", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();

    render(
      <Select aria-label="Город" defaultValue="baldur" onChange={handleChange}>
        <option value="baldur">Врата Балдура</option>
        <option value="waterdeep">Глубоководье</option>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: "Город" });
    expect(trigger).toHaveTextContent("Врата Балдура");

    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Глубоководье" }));

    expect(trigger).toHaveTextContent("Глубоководье");
    expect(handleChange).toHaveBeenCalled();
  });

  it("handles controlled value correctly", () => {
    function Controlled() {
      const [val, setVal] = useState("a");
      return (
        <Select
          aria-label="Буква"
          value={val}
          onValueChange={setVal}
          options={[
            { value: "a", label: "Альфа" },
            { value: "b", label: "Бета" },
          ]}
        />
      );
    }

    render(<Controlled />);
    const trigger = screen.getByRole("combobox", { name: "Буква" });
    expect(trigger).toHaveTextContent("Альфа");
  });

  it("passes accessibility attributes and invalid state to the trigger", () => {
    render(
      <>
        <span id="label-id">Тема</span>
        <p id="error-id">Обязательное поле</p>
        <Select
          id="custom-select"
          aria-labelledby="label-id"
          aria-describedby="error-id"
          validationState="invalid"
          options={[{ value: "1", label: "Один" }]}
        />
      </>,
    );

    const trigger = screen.getByRole("combobox", { name: "Тема" });
    expect(trigger).toHaveAttribute("id", "custom-select");
    expect(trigger).toHaveAccessibleDescription("Обязательное поле");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
  });

  it("handles createAction without modifying selection", async () => {
    const user = userEvent.setup();
    const create = vi.fn();
    const change = vi.fn();

    render(
      <Select
        aria-label="Категория"
        defaultValue="weapons"
        onChange={change}
        createAction={{ label: "Создать категорию", onSelect: create }}
        options={[
          { value: "weapons", label: "Оружие" },
          { value: "armor", label: "Броня" },
        ]}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Категория" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Создать категорию" }));

    expect(create).toHaveBeenCalledOnce();
    expect(change).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("Оружие");
  });

  it("can be reopened after selecting an option", async () => {
    const user = userEvent.setup();
    render(
      <Select
        aria-label="Изображение"
        defaultValue="portrait"
        options={[
          { value: "portrait", label: "Портрет" },
          { value: "marker", label: "Маркер" },
        ]}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Изображение" });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Маркер" }));
    expect(trigger).toHaveTextContent("Маркер");
    await user.click(trigger);
    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: "Маркер" }),
      ).toBeInTheDocument();
    });
  });

  it("moves Home to the first option before Enter commits it", async () => {
    const user = userEvent.setup();
    render(
      <Select
        aria-label="Категория"
        defaultValue="artifact"
        options={[
          { value: "other", label: "Другое" },
          { value: "artifact", label: "Артефакт" },
        ]}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Категория" });
    await user.click(trigger);
    await user.keyboard("{Home}");
    expect(screen.getByRole("option", { name: "Другое" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(trigger).toHaveTextContent("Другое");
  });

  it("forwards ref to the trigger button", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Select
        ref={ref}
        aria-label="Тест ref"
        options={[{ value: "1", label: "Тест" }]}
      />,
    );

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.getAttribute("role")).toBe("combobox");
  });
});

import { describe, expect, it } from "vitest";
import {
  formatReactConsoleMessage,
  isReactDefect,
} from "./e2e/react-console-format";

/**
 * UIX-521. Страж консоли живёт в e2e, а Vitest туда не заходит — но решение о
 * том, что считать дефектом, и приведение сообщения к читаемому виду это
 * чистые функции, и проверять их браузером было бы двадцатиминутной проверкой
 * того, что проверяется за миллисекунду.
 *
 * Настоящее сообщение взято дословно из прогона с намеренно внесённым
 * setState в теле рендера `Orthographic2DRenderer`, а не сочинено: сочинённое
 * закрепило бы мои представления о формате React, а не сам формат.
 */
const REAL_FORMAT =
  "Cannot update a component (`%s`) while rendering a different component " +
  "(`%s`). To locate the bad setState() call inside `%s`, follow the stack " +
  "trace as described in https://react.dev/link/setstate-in-render";

/** То же сообщение в склеенном виде — так его отдаёт `ConsoleMessage.text()`. */
const REAL_MESSAGE =
  REAL_FORMAT + " App Orthographic2DRenderer Orthographic2DRenderer";

describe("что страж считает дефектом", () => {
  it("узнаёт setState во время чужого рендера", () => {
    expect(isReactDefect(REAL_MESSAGE)).toBe(true);
  });

  it("узнаёт цикл обновлений", () => {
    expect(
      isReactDefect("Maximum update depth exceeded. This can happen when…"),
    ).toBe(true);
  });

  it.each([
    "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    "Failed to load resource: the server responded with a status of 404 (Not Found)",
    "Failed to load resource: net::ERR_CONNECTION_RESET",
  ])("не трогает шум браузера: %s", (noise) => {
    // Ровно эти строки печатает браузер в каждом прогоне: вход ещё не
    // состоялся, favicon отсутствует, CDN шрифтов недоступен. Проверка,
    // падающая на них, была бы выключена в тот же день.
    expect(isReactDefect(noise)).toBe(false);
  });
});

describe("приведение сообщения к читаемому виду", () => {
  it("возвращает имена компонентов на места подстановок", () => {
    expect(
      formatReactConsoleMessage(REAL_FORMAT, [
        "App",
        "Orthographic2DRenderer",
        "Orthographic2DRenderer",
      ]),
    ).toBe(
      "Cannot update a component (`App`) while rendering a different " +
        "component (`Orthographic2DRenderer`). To locate the bad setState() " +
        "call inside `Orthographic2DRenderer`, follow the stack trace as " +
        "described in https://react.dev/link/setstate-in-render",
    );
  });

  it("оставляет как есть сообщение без подстановок", () => {
    const plain = "Maximum update depth exceeded.";
    expect(formatReactConsoleMessage(plain, [])).toBe(plain);
  });

  it("не выдумывает подстановку, когда аргументов меньше, чем мест", () => {
    // Прежняя версия отрезала хвост текста по числу `%s` и на таком
    // сообщении съедала кусок самого текста. Теперь недостающее место
    // остаётся видимым, а не заполняется куском предложения.
    expect(formatReactConsoleMessage("(`%s`) и (`%s`)", ["App"])).toBe(
      "(`App`) и (`%s`)",
    );
  });

  it("не трогает лишние аргументы", () => {
    expect(formatReactConsoleMessage("(`%s`)", ["App", "Лишний"])).toBe(
      "(`App`)",
    );
  });
});

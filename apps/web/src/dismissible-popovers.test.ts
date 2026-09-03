import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * UIX-531 — каждый поповер закрывается общим механизмом.
 *
 * История, ради которой этот тест существует. UIX-517 нашла, что поповеры
 * громкости и меню музыки не закрывались и перехватывали клики по вкладкам
 * чата, починила их — и оставила указание проверить остальные. Проверка нашла
 * меню сеанса: оно объявлено **в одном CSS-правиле** с починенными, свешивается
 * на тот же участок экрана и точно так же перехватывало клики.
 *
 * То есть дефект возвращался дважды, и оба раза его находили по жалобе. Тест
 * закрывает не три конкретных поповера, а сам способ их забыть: новый
 * `<details>` без `useDismissibleDetails` роняет прогон, пока автор не решит
 * явно — это поповер поверх чужого содержимого или секция в потоке.
 */
const sourceOf = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const SOURCES = [
  "./App.tsx",
  "./MapToolbar.tsx",
  "./MusicBar.tsx",
  "./WorkspaceNav.tsx",
  "./renderers/GridSettings.tsx",
  "./sidebar/ChatPanels.tsx",
  "./sidebar/CharacterWorkspace.tsx",
  "./sidebar/InitiativePanel.tsx",
  "./sidebar/ResourceCounters.tsx",
] as const;

/**
 * Раскрывающиеся секции в потоке документа: они ничего не перекрывают, потому
 * что не спозиционированы `absolute`. Закрывать их по клику снаружи было бы
 * вредно — человек раскрыл ресурсы и работает рядом с ними.
 */
const IN_FLOW_SECTIONS = new Set([
  "subsection",
  "initiative-panel",
  "resource-counters",
]);

interface FoundDetails {
  file: string;
  className: string;
  hasRef: boolean;
}

const collectDetails = (): FoundDetails[] =>
  SOURCES.flatMap((file) => {
    const source = sourceOf(file);
    return [...source.matchAll(/<details\b([^>]*)>/g)].map((match) => {
      const attributes = match[1]!;
      const className = /className="([^"]+)"/.exec(attributes)?.[1] ?? "";
      return {
        file,
        className: className.split(/\s+/)[0] ?? "",
        hasRef: /\bref=\{/.test(attributes),
      };
    });
  });

describe("поповеры закрываются общим механизмом", () => {
  const found = collectDetails();

  it("находит все <details> в интерфейсе — иначе проверять нечего", () => {
    // Страховка от собственной регулярки: если разбор перестанет что-то
    // видеть, остальные проверки станут зелёными по пустому множеству.
    expect(found.length).toBeGreaterThanOrEqual(13);
    expect(found.every((item) => item.className !== "")).toBe(true);
  });

  it("каждый поповер держит ref — без него хук не к чему прицепить", () => {
    const withoutRef = found
      .filter((item) => !IN_FLOW_SECTIONS.has(item.className))
      .filter((item) => !item.hasRef)
      .map((item) => `${item.file}: .${item.className}`);
    expect(
      withoutRef,
      "поповер без ref не может закрываться по клику снаружи",
    ).toEqual([]);
  });

  it("каждый ref поповера передан в useDismissibleDetails", () => {
    // Одного `ref` мало: он может стоять ради фокуса или измерения. Проверяем
    // именно вызов — это и есть общий механизм.
    const missing: string[] = [];
    for (const file of SOURCES) {
      const source = sourceOf(file);
      const dismissed = new Set(
        [...source.matchAll(/useDismissibleDetails\((\w+)/g)].map(
          (match) => match[1]!,
        ),
      );
      for (const match of source.matchAll(/<details\b([^>]*)>/g)) {
        const attributes = match[1]!;
        const className =
          /className="([^"]+)"/.exec(attributes)?.[1]?.split(/\s+/)[0] ?? "";
        if (IN_FLOW_SECTIONS.has(className)) continue;
        const ref = /\bref=\{(\w+)\}/.exec(attributes)?.[1];
        if (!ref || !dismissed.has(ref)) missing.push(`${file}: .${className}`);
      }
    }
    expect(
      missing,
      "у этого поповера есть ref, но закрытие к нему не подключено",
    ).toEqual([]);
  });

  it("секции в потоке перечислены поимённо, а не угаданы", () => {
    // Список — это решение «здесь закрытие не нужно», а не забывчивость.
    // Незнакомый класс сюда не попадёт: он свалится в проверки выше.
    const inFlow = found
      .filter((item) => IN_FLOW_SECTIONS.has(item.className))
      .map((item) => item.className);
    expect([...new Set(inFlow)].sort()).toEqual([
      "initiative-panel",
      "resource-counters",
      "subsection",
    ]);
  });
});

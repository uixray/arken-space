// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitiativeParticipantDto } from "@arken/contracts";
import { renderComponent } from "./test-support/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: apiMock }));

const { useInitiativeActions } = await import("./use-initiative-actions");

/**
 * UIX-466 п. 9 — закрепление обязано доехать до сервера.
 *
 * Хук собирает отправляемого участника вручную, поле за полем: `canEdit` и
 * `initiativeBonus` вычисляет сервер, и слать их обратно нечего. Плата за
 * ручной список — забытое поле, и она уже была уплачена: `pinned` в него не
 * попал, кнопки ↑/↓ работали в панели и гибли по дороге. Снаружи это выглядело
 * как «закрепление не сохраняется», а тесты панели и сервера были зелёными:
 * каждый проверял свой конец провода.
 */
const participant = (
  id: string,
  overrides: Partial<InitiativeParticipantDto> = {},
): InitiativeParticipantDto => ({
  id,
  tokenId: `токен-${id}`,
  name: `Имя ${id}`,
  ownName: null,
  initiative: 10,
  initiativeBonus: null,
  canEdit: true,
  pinned: false,
  ...overrides,
});

/**
 * Хук живёт в настоящем рендере: `useMemo` вне его вызвать нельзя, а подменять
 * React ради этого значило бы проверять подмену.
 */
const actions = () => {
  const load = vi.fn(async () => {});
  let captured!: ReturnType<typeof useInitiativeActions>;
  function Probe() {
    captured = useInitiativeActions({ load });
    return null;
  }
  renderComponent(<Probe />);
  return captured;
};

const sentBody = (call: number) =>
  JSON.parse((apiMock.mock.calls[call]![1] as { body: string }).body);

describe("отправка очереди на сервер", () => {
  beforeEach(() => {
    apiMock.mockReset();
    apiMock.mockResolvedValue({});
  });

  it("везёт закрепление вместе с составом", async () => {
    const { onUpdateInitiative } = actions();
    await onUpdateInitiative(
      [participant("a", { pinned: true }), participant("b")],
      7,
    );
    expect(sentBody(0).participants).toEqual([
      expect.objectContaining({ id: "a", pinned: true }),
      expect.objectContaining({ id: "b", pinned: false }),
    ]);
  });

  it("не теряет закрепление при броске за участника", async () => {
    // Бросок отправляет очередь целиком тем же маршрутом. Забыв поле здесь,
    // мы стирали бы расстановку каждым кубиком — то есть чаще всего.
    const { onRollInitiative } = actions();
    apiMock.mockResolvedValueOnce({ dice: { total: 18 } });
    const roster = [participant("a", { pinned: true }), participant("b")];
    await onRollInitiative(roster, roster[1]!, 7, true);
    expect(sentBody(1).participants).toEqual([
      expect.objectContaining({ id: "a", pinned: true, initiative: 10 }),
      expect.objectContaining({ id: "b", pinned: false, initiative: 18 }),
    ]);
  });

  it("шлёт собственное имя, а не показанное", async () => {
    // UIX-400: показанное имя наследуется от токена. Отправив его, панель
    // молча превратила бы наследование в копию.
    const { onUpdateInitiative } = actions();
    await onUpdateInitiative(
      [participant("a", { name: "Имя от токена", ownName: null })],
      7,
    );
    expect(sentBody(0).participants[0].name).toBeNull();
  });
});

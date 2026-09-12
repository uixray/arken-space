import { describe, expect, it, vi } from "vitest";
import { seedChatLog } from "./e2e/chat-seed.js";

type SeedOptions = Parameters<typeof seedChatLog>[1];
type SeedResponse = Awaited<ReturnType<SeedOptions["post"]>>;

function response(
  status: number,
  retryAfter: string | null = null,
): SeedResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    retryAfter,
    body: `Ответ ${status}`,
  };
}

function createHarness() {
  let nextId = 0;
  return {
    post: vi.fn<SeedOptions["post"]>().mockResolvedValue(response(201)),
    wait: vi.fn<SeedOptions["wait"]>().mockResolvedValue(undefined),
    actionId: vi.fn(() => `action-${nextId++}`),
    extendTimeout: vi.fn<SeedOptions["extendTimeout"]>(),
  };
}

function expectedPayload(index: number) {
  return {
    actionId: `action-${index}`,
    body: `Запись журнала ${index} — достаточно длинная, чтобы занять высоту и переполнить ленту событий.`,
    stream: "TABLE",
  };
}

describe("UIX-475 — подготовка журнала с ограниченным повтором 429", () => {
  it("создаёт ровно 40 записей с уникальными actionId и 39 паузами без кредита таймаута", async () => {
    const harness = createHarness();

    await seedChatLog(40, harness);

    expect(harness.post).toHaveBeenCalledTimes(40);
    expect(harness.actionId).toHaveBeenCalledTimes(40);
    const payloads = harness.post.mock.calls.map(([payload]) => payload);
    expect(payloads).toEqual(
      Array.from({ length: 40 }, (_, index) => expectedPayload(index)),
    );
    expect(new Set(payloads.map(({ actionId }) => actionId)).size).toBe(40);
    expect(harness.wait.mock.calls).toEqual(
      Array.from({ length: 39 }, () => [250]),
    );
    expect(harness.extendTimeout).not.toHaveBeenCalled();
  });

  it.each([7, 17, 60])(
    "соблюдает Retry-After %i секунд плюс 100 мс и повторяет тот же payload",
    async (seconds) => {
      const harness = createHarness();
      harness.post.mockResolvedValueOnce(response(429, String(seconds)));

      await seedChatLog(2, harness);

      const payloads = harness.post.mock.calls.map(([payload]) => payload);
      expect(payloads).toEqual([
        expectedPayload(0),
        expectedPayload(0),
        expectedPayload(1),
      ]);
      expect(payloads[1]).toBe(payloads[0]);
      expect(harness.actionId).toHaveBeenCalledTimes(2);
      const cooldown = seconds * 1000 + 100;
      expect(harness.wait.mock.calls).toEqual([[cooldown], [250]]);
      expect(harness.extendTimeout.mock.calls).toEqual([[cooldown]]);
    },
  );

  it.each([400, 401, 403, 409, 500, 503])(
    "не повторяет HTTP %i даже при наличии Retry-After",
    async (status) => {
      const harness = createHarness();
      harness.post.mockResolvedValueOnce(response(status, "7"));

      await expect(seedChatLog(2, harness)).rejects.toThrow(`Ответ ${status}`);

      expect(harness.post).toHaveBeenCalledTimes(1);
      expect(harness.actionId).toHaveBeenCalledTimes(1);
      expect(harness.wait).not.toHaveBeenCalled();
      expect(harness.extendTimeout).not.toHaveBeenCalled();
    },
  );

  it("не повторяет сетевую ошибку и сохраняет исходное исключение", async () => {
    const harness = createHarness();
    const error = new Error("Сетевая ошибка фикстуры");
    harness.post.mockRejectedValueOnce(error);

    await expect(seedChatLog(2, harness)).rejects.toBe(error);

    expect(harness.post).toHaveBeenCalledTimes(1);
    expect(harness.actionId).toHaveBeenCalledTimes(1);
    expect(harness.wait).not.toHaveBeenCalled();
    expect(harness.extendTimeout).not.toHaveBeenCalled();
  });

  it.each([null, "", "не число", "0", "-1", "1.5", "61", "7s", " 7", "7 "])(
    "отклоняет 429 с недопустимым Retry-After %j без ожидания или повторов",
    async (retryAfter) => {
      const harness = createHarness();
      harness.post.mockResolvedValueOnce(response(429, retryAfter));

      await expect(seedChatLog(2, harness)).rejects.toThrow(
        "seedLog: некорректный или повторный 429: Ответ 429",
      );

      expect(harness.post).toHaveBeenCalledTimes(1);
      expect(harness.actionId).toHaveBeenCalledTimes(1);
      expect(harness.wait).not.toHaveBeenCalled();
      expect(harness.extendTimeout).not.toHaveBeenCalled();
    },
  );

  it("ограничивает повторы двумя на весь seed, а не на каждую запись", async () => {
    const harness = createHarness();
    harness.post
      .mockResolvedValueOnce(response(429, "7"))
      .mockResolvedValueOnce(response(201))
      .mockResolvedValueOnce(response(429, "17"))
      .mockResolvedValueOnce(response(201))
      .mockResolvedValueOnce(response(429, "60"));

    await expect(seedChatLog(3, harness)).rejects.toThrow(
      "seedLog: некорректный или повторный 429: Ответ 429",
    );

    const payloads = harness.post.mock.calls.map(([payload]) => payload);
    expect(payloads).toEqual([
      expectedPayload(0),
      expectedPayload(0),
      expectedPayload(1),
      expectedPayload(1),
      expectedPayload(2),
    ]);
    expect(payloads[1]).toBe(payloads[0]);
    expect(payloads[3]).toBe(payloads[2]);
    expect(harness.actionId).toHaveBeenCalledTimes(3);
    expect(harness.wait.mock.calls).toEqual([[7100], [250], [17100], [250]]);
    expect(harness.extendTimeout.mock.calls).toEqual([[7100], [17100]]);
  });

  it("останавливается на третьем подряд 429 одной записи без третьего cooldown", async () => {
    const harness = createHarness();
    harness.post.mockResolvedValue(response(429, "7"));

    await expect(seedChatLog(1, harness)).rejects.toThrow(
      "seedLog: некорректный или повторный 429: Ответ 429",
    );

    const payloads = harness.post.mock.calls.map(([payload]) => payload);
    expect(payloads).toEqual([
      expectedPayload(0),
      expectedPayload(0),
      expectedPayload(0),
    ]);
    expect(payloads[1]).toBe(payloads[0]);
    expect(payloads[2]).toBe(payloads[0]);
    expect(harness.actionId).toHaveBeenCalledTimes(1);
    expect(harness.wait.mock.calls).toEqual([[7100], [7100]]);
    expect(harness.extendTimeout.mock.calls).toEqual([[7100], [7100]]);
  });

  it("ошибка паузы между записями останавливает seed до следующего post", async () => {
    const harness = createHarness();
    const error = new Error("Ошибка pacing фикстуры");
    harness.wait.mockRejectedValueOnce(error);

    await expect(seedChatLog(2, harness)).rejects.toBe(error);

    expect(harness.post.mock.calls).toEqual([[expectedPayload(0)]]);
    expect(harness.actionId).toHaveBeenCalledTimes(1);
    expect(harness.wait.mock.calls).toEqual([[250]]);
    expect(harness.extendTimeout).not.toHaveBeenCalled();
  });

  it("ошибка cooldown останавливает seed без повторного post", async () => {
    const harness = createHarness();
    const error = new Error("Ошибка cooldown фикстуры");
    harness.post.mockResolvedValueOnce(response(429, "7"));
    harness.wait.mockRejectedValueOnce(error);

    await expect(seedChatLog(2, harness)).rejects.toBe(error);

    expect(harness.post.mock.calls).toEqual([[expectedPayload(0)]]);
    expect(harness.actionId).toHaveBeenCalledTimes(1);
    expect(harness.wait.mock.calls).toEqual([[7100]]);
    expect(harness.extendTimeout.mock.calls).toEqual([[7100]]);
  });
});

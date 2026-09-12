type ChatSeedPayload = {
  actionId: string;
  body: string;
  stream: "TABLE";
};

type ChatSeedResponse = {
  ok: boolean;
  status: number;
  retryAfter: string | null;
  body: string;
};

/** Подготовка переполненной ленты, а не проверка пользовательского rate limit. */
export async function seedChatLog(
  count: number,
  {
    post,
    wait,
    actionId,
    extendTimeout,
  }: {
    post: (payload: ChatSeedPayload) => Promise<ChatSeedResponse>;
    wait: (milliseconds: number) => Promise<void>;
    actionId: () => string;
    extendTimeout: (milliseconds: number) => void;
  },
) {
  let rateLimitRetries = 0;
  for (let index = 0; index < count; index += 1) {
    // У разных кампаний один IP-limit; seed не должен расходовать окно залпом.
    if (index > 0) await wait(250);
    const payload: ChatSeedPayload = {
      actionId: actionId(),
      body: `Запись журнала ${index} — достаточно длинная, чтобы занять высоту и переполнить ленту событий.`,
      stream: "TABLE",
    };
    for (;;) {
      const response = await post(payload);
      if (response.ok) break;
      if (response.status !== 429) throw new Error(response.body);
      const retrySeconds = Number(response.retryAfter);
      // @fastify/rate-limit возвращает целые секунды остатка минутного окна.
      // Повторяем только отклонённый запрос с тем же actionId, не сетевые ошибки.
      if (
        !/^\d+$/.test(response.retryAfter ?? "") ||
        !Number.isSafeInteger(retrySeconds) ||
        retrySeconds < 1 ||
        retrySeconds > 60 ||
        rateLimitRetries >= 2
      ) {
        throw new Error(
          `seedLog: некорректный или повторный 429: ${response.body}`,
        );
      }
      rateLimitRetries += 1;
      const waitMs = retrySeconds * 1000 + 100;
      // Добавляем только объявленное сервером ожидание, а не время assertions.
      extendTimeout(waitMs);
      await wait(waitMs);
    }
  }
}

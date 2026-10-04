import { describe, expect, it } from "vitest";
import type { ActivityFilter } from "../apps/web/src/activity-roll-controls.js";
import {
  ACTIVITY_FILTERS,
  activityFilterSummaryTitle,
  hiddenActivityStreamCount,
} from "../apps/web/src/activity-filter-menu.js";
import {
  allowedSidebarFeed,
  chatFeedOrder,
} from "../apps/web/src/sidebar-feed.js";

const all = () => new Set<ActivityFilter>(ACTIVITY_FILTERS);

describe("UIX-467 — свёрнутые фильтры ленты", () => {
  it("со всеми включёнными потоками не сообщает о скрытых", () => {
    expect(hiddenActivityStreamCount(all())).toBe(0);
    expect(activityFilterSummaryTitle(all())).toBe(
      "Показывать: включены все потоки",
    );
  });

  it("считает именно выключенные потоки", () => {
    const filters = all();
    filters.delete("ROLLS");
    filters.delete("REFERENCE");
    expect(hiddenActivityStreamCount(filters)).toBe(2);
  });

  it("называет в подсказке, что именно скрыто", () => {
    const filters = all();
    filters.delete("REFERENCE");
    expect(activityFilterSummaryTitle(filters)).toBe(
      "Показывать. Скрыто: Справочные события",
    );
  });

  it("перечисляет скрытое в порядке самих фильтров, а не снятия галочек", () => {
    const filters = all();
    filters.delete("REFERENCE");
    filters.delete("ROLLS");
    expect(activityFilterSummaryTitle(filters)).toBe(
      "Показывать. Скрыто: Броски, Справочные события",
    );
  });
});

describe("UIX-467 — единственная лента без лишних вкладок", () => {
  it("мастеру остаётся только единая лента событий", () => {
    expect(chatFeedOrder(true)).toEqual(["ACTIVITY"]);
  });

  it("игроку остаются только «События»", () => {
    expect(chatFeedOrder(false)).toEqual(["ACTIVITY"]);
  });

  it("«Стол» и «Броски» не становятся вкладками ни у кого", () => {
    for (const isGm of [true, false]) {
      expect(chatFeedOrder(isGm)).not.toContain("TABLE");
      expect(chatFeedOrder(isGm)).not.toContain("ROLLS");
    }
  });

  it("игрока, оказавшегося на «Сюжете», возвращает к «Событиям»", () => {
    // Переход к сообщению сюжета выставляет ленту в обход вкладок — без этой
    // нормализации игрок остался бы на панели, вкладки которой у него нет.
    expect(allowedSidebarFeed("STORY", false)).toBe("ACTIVITY");
  });

  it("мастера на скрытом «Сюжете» возвращает к событиям", () => {
    expect(allowedSidebarFeed("STORY", true)).toBe("ACTIVITY");
  });
});

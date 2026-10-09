/**
 * UIX-652: short, source-traced procedures for the existing landing guide.
 * Keep the instructions here (rather than duplicating prose in JSX). Recheck
 * the listed UI/source anchors whenever those controls or role gates change.
 * The guide stays intentionally small: it covers four common, implemented
 * actions, not every feature or a replacement for in-session help.
 */
export interface GuideWorkflow {
  id: string;
  title: string;
  roles: readonly ("Мастер" | "Игрок")[];
  prerequisite: string;
  steps: readonly string[];
  outcome: string;
  helpHref: string;
  sources: readonly string[];
}

export interface GuideFaq {
  id: string;
  question: string;
  answer: string;
  helpHref: string;
  sources: readonly string[];
}

export const guideWorkflows: readonly GuideWorkflow[] = [
  {
    id: "ping-map",
    title: "Показать точку на карте",
    roles: ["Мастер", "Игрок"],
    prerequisite: "Откройте игровую карту.",
    steps: [
      "Наведите курсор на нужное место.",
      "Зажмите Ctrl и щёлкните мышью.",
    ],
    outcome: "Остальные участники увидят пинг в этой точке.",
    helpHref: "#guide-камера",
    sources: [
      "apps/web/src/landing-guide-content.ts — раздел «Камера»",
      "apps/web/src/renderers/Orthographic2DRenderer.tsx — Ctrl-click ping",
    ],
  },
  {
    id: "send-chat-message",
    title: "Отправить сообщение в общий чат",
    roles: ["Мастер", "Игрок"],
    prerequisite: "Откройте чат, где отображается поле «Сообщение или бросок».",
    steps: [
      "Введите текст в поле «Сообщение или бросок».",
      "Нажмите кнопку отправки или Enter.",
    ],
    outcome: "Сообщение отправится участникам общего чата.",
    helpHref: "#guide-чат-и-броски",
    sources: [
      "apps/web/src/sidebar/ChatPanels.tsx — composer label, submit button",
      "apps/web/src/landing-guide-content.ts — chat key behavior",
    ],
  },
  {
    id: "make-player-request",
    title: "Предложить действие мастеру",
    roles: ["Игрок"],
    prerequisite: "Откройте раздел «Мои заявки».",
    steps: [
      "Заполните «Название» и «Описание».",
      "Выберите срок и аудиторию; при желании укажите персонажа.",
      "Нажмите «Отправить заявку».",
    ],
    outcome:
      "Заявка появится в списке игрока; видимость зависит от выбранной аудитории.",
    helpHref: "#guide-чат-и-броски",
    sources: [
      "apps/web/src/workspace-nav.ts — role-specific request section label",
      "apps/web/src/PlayerRequestsWorkspace.tsx — PLAYER form and submit",
      "apps/web/src/player-request-ui.ts — visibility and status rules",
    ],
  },
  {
    id: "review-player-requests",
    title: "Разобрать заявки игроков",
    roles: ["Мастер"],
    prerequisite: "Откройте раздел «Открытые заявки».",
    steps: [
      "Просмотрите заявки в списке.",
      "Для отправленной заявки используйте «Принять», «Решить» или «Отклонить».",
      "При решении или отклонении добавьте комментарий, если он нужен.",
    ],
    outcome:
      "Статус заявки обновится; игрок увидит актуальное состояние в своих заявках.",
    helpHref: "#guide-чат-и-броски",
    sources: [
      "apps/web/src/workspace-nav.ts — GM request section label",
      "apps/web/src/PlayerRequestsWorkspace.tsx — GM actions and status branches",
    ],
  },
];

export const guideFaq: readonly GuideFaq[] = [
  {
    id: "fog-access",
    question: "Почему инструменты тумана не видны игроку?",
    answer:
      "Закрывать и открывать туман может только мастер; игроку эти инструменты не показываются.",
    helpHref: "#guide-туман-войны",
    sources: [
      "apps/web/src/landing-guide-content.ts — fog section",
      "apps/web/src/MapToolbar.tsx — GM-only map tools",
    ],
  },
  {
    id: "chat-audience",
    question: "Кому уйдёт сообщение из общего чата?",
    answer:
      "Обычная отправка адресована общему чату. Отправка только мастеру доступна через Ctrl+Enter.",
    helpHref: "#guide-чат-и-броски",
    sources: [
      "apps/web/src/landing-guide-content.ts — chat shortcuts",
      "apps/web/src/sidebar/ChatPanels.tsx — composer submit",
    ],
  },
  {
    id: "request-audience",
    question: "Кто увидит заявку игрока?",
    answer:
      "При создании выберите «Всем участникам» или «Автору и всем мастерам» в поле «Кто увидит».",
    helpHref: "#guide-чат-и-броски",
    sources: [
      "apps/web/src/PlayerRequestsWorkspace.tsx — audience selector",
      "apps/web/src/player-request-ui.ts — audience labels and filtering",
    ],
  },
  {
    id: "guide-coverage",
    question: "Здесь описаны все функции?",
    answer:
      "Нет. Это короткие инструкции к нескольким проверенным действиям; полный список клавиш и команд остаётся ниже.",
    helpHref: "#guide-чат-и-броски",
    sources: [
      "apps/web/src/LandingGuide.tsx — existing shortcut sections and guide toggle",
    ],
  },
];

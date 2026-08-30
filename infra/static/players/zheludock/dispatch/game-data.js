export const mages = [
  {
    id: "spark",
    name: "Искра",
    school: "Гроза",
    glyph: "ϟ",
    color: "#f3c84b",
    stats: { power: 4, control: 2, lore: 1, mobility: 5, empathy: 2 },
    trait: "Рвётся вперёд: сильнее на срочных вызовах, но быстрее устаёт.",
  },
  {
    id: "moss",
    name: "Мох",
    school: "Жизнь",
    glyph: "⌁",
    color: "#79b36b",
    stats: { power: 2, control: 4, lore: 3, mobility: 1, empathy: 5 },
    trait: "Не бросает пострадавших: смягчает последствия частичного успеха.",
  },
  {
    id: "prism",
    name: "Призма",
    school: "Иллюзии",
    glyph: "◇",
    color: "#cf8be8",
    stats: { power: 1, control: 5, lore: 4, mobility: 3, empathy: 3 },
    trait: "Находит третий путь: усиливает переговоры и обман.",
  },
  {
    id: "anvil",
    name: "Наковальня",
    school: "Камень",
    glyph: "⬟",
    color: "#d77f55",
    stats: { power: 5, control: 4, lore: 1, mobility: 1, empathy: 2 },
    trait: "Стоит до конца: надёжен при защите города.",
  },
  {
    id: "north",
    name: "Север",
    school: "Лёд",
    glyph: "✣",
    color: "#77c6da",
    stats: { power: 3, control: 5, lore: 3, mobility: 2, empathy: 1 },
    trait: "Холодный расчёт: повышает надёжность точных планов.",
  },
  {
    id: "whisper",
    name: "Шёпот",
    school: "Дух",
    glyph: "◉",
    color: "#e9a4a4",
    stats: { power: 2, control: 2, lore: 5, mobility: 4, empathy: 4 },
    trait: "Слышит невидимое: раскрывает скрытые угрозы.",
  },
];

export const missions = [
  {
    id: "runaway",
    district: "Медный рынок",
    title: "Сбежавший фамильяр",
    summary: "Огненная химера пугает торговцев, но пока никого не ранила.",
    requirements: { control: 5, empathy: 4, mobility: 3 },
    complication:
      "Химера защищает потерявшегося ребёнка и атакует любого, кто подходит.",
    choices: [
      {
        id: "lure",
        label: "Выманить лакомством",
        bonus: { empathy: 3, control: 1 },
        trust: 1,
      },
      {
        id: "net",
        label: "Накрыть сдерживающим полем",
        bonus: { control: 3 },
        fatigue: 1,
      },
      {
        id: "child",
        label: "Сначала вывести ребёнка",
        bonus: { mobility: 2, empathy: 2 },
        city: -1,
      },
    ],
  },
  {
    id: "bridge",
    district: "Северные ворота",
    title: "Мост теряет форму",
    summary: "Каменные пролёты размягчаются прямо под караваном.",
    requirements: { power: 6, control: 5, lore: 3 },
    complication:
      "Под мостом спит земляной великан; ремонт причиняет ему боль.",
    choices: [
      {
        id: "brace",
        label: "Укрепить мост и закончить быстро",
        bonus: { power: 3, control: 2 },
        trust: -1,
      },
      {
        id: "wake",
        label: "Разбудить великана и договориться",
        bonus: { empathy: 4, lore: 2 },
        fatigue: 1,
      },
      {
        id: "reroute",
        label: "Эвакуировать караван в обход",
        bonus: { mobility: 4 },
        city: -2,
      },
    ],
  },
  {
    id: "echo",
    district: "Архивная башня",
    title: "Эхо чужих воспоминаний",
    summary: "Читатели повторяют фразы людей, которых никогда не встречали.",
    requirements: { lore: 7, control: 4, empathy: 4 },
    complication:
      "Источник — запечатанная память основателя города, которая просит освобождения.",
    choices: [
      {
        id: "seal",
        label: "Запечатать память снова",
        bonus: { control: 3, lore: 2 },
        trust: -1,
      },
      {
        id: "listen",
        label: "Выслушать её до конца",
        bonus: { empathy: 4, lore: 3 },
        fatigue: 2,
      },
      {
        id: "copy",
        label: "Сделать безопасную копию",
        bonus: { lore: 5 },
        city: -1,
      },
    ],
  },
  {
    id: "storm",
    district: "Плавучий квартал",
    title: "Гроза идёт снизу",
    summary: "Молнии бьют из каналов вверх и поднимают дома в воздух.",
    requirements: { power: 8, mobility: 6, control: 5 },
    complication:
      "Шторм отвечает на страх жителей: грубая сила делает его мощнее.",
    choices: [
      {
        id: "ground",
        label: "Заземлить квартал",
        bonus: { power: 4, control: 2 },
        fatigue: 2,
      },
      {
        id: "calm",
        label: "Провести ритуал спокойствия",
        bonus: { empathy: 5, control: 2 },
        trust: 1,
      },
      {
        id: "chase",
        label: "Увести грозу за город",
        bonus: { mobility: 5, power: 2 },
        city: -2,
      },
    ],
  },
  {
    id: "crown",
    district: "Сердце Тристонии",
    title: "Корона без владельца",
    summary:
      "Над ратушей возникает древняя корона и выбирает нового правителя.",
    requirements: { lore: 8, empathy: 7, control: 7 },
    complication:
      "Корона называет Мишу единственным достойным кандидатом и требует ответ сейчас.",
    choices: [
      {
        id: "accept",
        label: "Принять корону на время",
        bonus: { power: 4, control: 3 },
        trust: -2,
      },
      {
        id: "council",
        label: "Предложить совет магов",
        bonus: { empathy: 5, lore: 3 },
        trust: 2,
      },
      {
        id: "refuse",
        label: "Разрушить право выбора короны",
        bonus: { lore: 4, power: 4 },
        fatigue: 2,
      },
    ],
  },
];

export const statLabels = {
  power: "Мощь",
  control: "Контроль",
  lore: "Знание",
  mobility: "Мобильность",
  empathy: "Эмпатия",
};

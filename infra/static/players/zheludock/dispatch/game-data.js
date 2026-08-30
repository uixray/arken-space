export const mages = [
  {
    id: "fenser", name: "Фенсер", school: "Стеклянная пушка", glyph: "⚔", color: "#d8d6ca", image: "./assets/heroes/fenser.webp",
    stats: { lore: 3, control: 2, power: 5, mobility: 5, empathy: 4 },
    trait: "Смертельно силён, но уязвим: высокий шанс тяжёлых последствий.",
  },
  {
    id: "rem", name: "Рэм О-Лор", school: "Император", glyph: "♛", color: "#cf594c", image: "./assets/heroes/rem.webp",
    stats: { lore: 4, control: 4, power: 5, mobility: 1, empathy: 5 },
    trait: "Могуч и медлителен. Может отказаться от недостойного задания.",
  },
  {
    id: "erkenvald", name: "Эркенвальд", school: "Исследователь", glyph: "✦", color: "#e29a46", image: "./assets/heroes/erkenvald.webp",
    stats: { lore: 5, control: 3, power: 2, mobility: 3, empathy: 4 },
    trait: "Блестящий ум, хроническое невезение: прогноз может дать сбой.",
  },
  {
    id: "tir", name: "Тир-На-Эль Куэркас", school: "Хранитель чащи", glyph: "❧", color: "#70a65e", image: "./assets/heroes/tir.webp",
    stats: { lore: 4, control: 5, power: 3, mobility: 3, empathy: 3 },
    trait: "Читает живые системы и лучше всего решает природные аномалии.",
  },
  {
    id: "makoto", name: "Макото", school: "Диверсант", glyph: "刃", color: "#d04f46", image: "./assets/heroes/makoto.webp",
    stats: { lore: 4, control: 2, power: 4, mobility: 5, empathy: 3 },
    trait: "Очень быстр и хитёр. Может самовольно сменить цель задания.",
  },
  {
    id: "adora", name: "Адора", school: "Связующая", glyph: "◆", color: "#54c7df", image: "./assets/heroes/adora.webp",
    stats: { lore: 3, control: 4, power: 3, mobility: 4, empathy: 5 },
    trait: "Добрая и командная: усиливает любого союзника, кроме Рэма.",
  },
  {
    id: "memphis", name: "Мемфис", school: "Мудрец", glyph: "◉", color: "#508ed4", image: "./assets/heroes/memphis.webp",
    stats: { lore: 4, control: 5, power: 2, mobility: 1, empathy: 3 },
    trait: "Медленный и мудрый. Снижает цену сложных решений.",
  },
];

export const missions = [
  {
    id: "runaway",
    district: "Норбиан",
    map: { x: 23, y: 25 },
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
    district: "Сайдрис",
    map: { x: 17, y: 44 },
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
    district: "Хельдрис",
    map: { x: 55, y: 43 },
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
    district: "Диларн",
    map: { x: 64, y: 69 },
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
    district: "Триумн",
    map: { x: 84, y: 34 },
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
  power: "Сила",
  control: "Мудрость",
  lore: "Ум",
  mobility: "Ловкость",
  empathy: "Красота",
};

import type { CharacterCatalogEntryDto } from "@arken/contracts";
const commonAbilityNames = ["Фокус", "Магический щит", "Передышка"];
  const uniqueAbilityOrder = [
    "Арсенал вечной мерзлоты", "Ложный строй", "Ледяной марш",
    "Обличие ледяного дракона", "Шесть ступеней Тримуна",
    "Телекинез", "Упор", "Поворот тяжести", "Сдвиг свойства",
    "Парный портал", "Пузырь Амберьерри", "Отвод",
    "Луч поддержки", "Перенос ран", "Усиливающее зелье",
    "Подмена защитника", "Световой прыжок", "Связь Гомпта",
    "Снаряд хаоса", "Аура Дорса", "Оружие хаоса", "Воля случая",
    "Чтение изъяна", "Печать условия", "Обет открытой руки",
    "Равноценный договор", "Личная жертва", "Врата Серой долины",
  ];
  const abilityRank = (name: string) => {
    const stage = /^Тримун ([1-6])/.exec(name);
    if (stage) return 4 + Number(stage[1]) / 10;
    const index = uniqueAbilityOrder.indexOf(name);
    return index < 0 ? 100 : index;
  };

export const abilityDisplayName = (name: string) => name.replace(/^Школьные чары\s*[·:—-]?\s*/i, "").replace(/\s*\(ШЧ\)$/, "") + (/^Школьные чары/i.test(name) || /\(ШЧ\)$/.test(name) ? " (ШЧ)" : "");
export function abilityCost(entry: CharacterCatalogEntryDto) {
  if (entry.data.areaEffect) return "1d6 маны";
  const cost = entry.data.activation?.cost;
  return cost ? `${cost.amount} ${cost.type === "physical" ? "выносливости" : "маны"}` : "0 маны";
}
export function groupAbilities(entries: CharacterCatalogEntryDto[]) {
  const school = (e: CharacterCatalogEntryDto) => /^Школьные чары/i.test(e.name) || /\(ШЧ\)$/.test(e.name);
  return [
    {id:"unique",label:"Уникальные заклинания",entries:entries.filter(e=>!school(e)&&!commonAbilityNames.includes(e.name)).sort((a,b)=>abilityRank(a.name)-abilityRank(b.name)||a.name.localeCompare(b.name,"ru"))},
    {id:"common",label:"Общие способности",entries:entries.filter(e=>!school(e)&&commonAbilityNames.includes(e.name)).sort((a,b)=>commonAbilityNames.indexOf(a.name)-commonAbilityNames.indexOf(b.name))},
    {id:"school",label:"Школьные заклинания",entries:entries.filter(school).sort((a,b)=>abilityDisplayName(a.name).localeCompare(abilityDisplayName(b.name),"ru"))},
  ].filter(g=>g.entries.length);
}

export function usesAmberionAbilityGroups(
  campaignId: string,
  ownerRole: "GM" | "PLAYER" | undefined,
): boolean {
  return campaignId === "eb6a55c4-a821-4739-8d4a-a1028e9d9092" && ownerRole === "PLAYER";
}

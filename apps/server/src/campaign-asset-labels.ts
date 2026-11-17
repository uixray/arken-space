// Campaign-specific display labels; preserve IDs and any later user rename.
const amberionLabels: Record<string, { original: string; label: string }> = {
  "b2fdd0c1-2e02-4833-afb1-9df97244e5fd": {
    "original": "SFX 02-clock-short",
    "label": "02 — Куранты — короткий сигнал"
  },
  "d1f0b02d-145e-42d5-b61f-f38177d3ca37": {
    "original": "SFX 01-crowd-short",
    "label": "01 — Бал — короткий шум толпы"
  },
  "fd90a412-0fa8-477a-9b3c-d4dd00f89157": {
    "original": "SFX 03-clock-fifth-strike-stop",
    "label": "02 — Куранты — скрежет на пятом ударе"
  },
  "98e68f2a-eb66-4832-925f-bd3379ed065f": {
    "original": "SFX 02-clock",
    "label": "02 — Куранты — полный звон"
  },
  "3d0fc59d-5d7c-4df3-92fe-f517db7d5cd5": {
    "original": "SFX 01-crowd",
    "label": "01 — Бал — шум толпы"
  },
  "1bbbb7a0-19d2-452a-88cd-de86b62ebccf": {
    "original": "15 - Broken Reality",
    "label": "Вне очереди — Снежная петля — Broken Reality"
  },
  "1603c06e-8cfc-416a-9b29-5b5f6c2bd913": {
    "original": "13 - Mirror Peak",
    "label": "10 — Обратный путь — Mirror Peak"
  },
  "8165da89-63ee-44f7-a3b4-1473b9b71151": {
    "original": "12 - The Clicker",
    "label": "09 — Передача искры — The Clicker"
  },
  "59b84b30-7bf8-45b9-bb25-41e74b289865": {
    "original": "11 - Tom the Diver",
    "label": "09 — Речь Амбериона — Tom the Diver"
  },
  "d30abaf8-58b0-4c70-bf29-6a8d058452a1": {
    "original": "10 - The Lighthouse",
    "label": "08 — Подъём в башню — The Lighthouse"
  },
  "19ac54be-d44d-4e91-b9c7-332420bdc4e6": {
    "original": "09 - Walking Transition",
    "label": "05а — Комната с сеном — Walking Transition"
  },
  "37de7a87-1d63-47da-9ac1-1e9c354a8781": {
    "original": "08 - Hydraponic Farm",
    "label": "06 — Оранжерея — Hydraponic Farm"
  },
  "efa73549-accf-478b-a9f2-56f648e45f5b": {
    "original": "07 - Bargain",
    "label": "05б — Сокровищница — Bargain"
  },
  "fa1db373-aed1-40ce-b843-d718639752f1": {
    "original": "06 - Taken By the Night",
    "label": "07 — Нефритовые статуи — Taken By the Night"
  },
  "fc405f3d-7a61-4fca-80e5-5cc369d0398a": {
    "original": "05 - Water Pressure",
    "label": "05в — Стоки — Water Pressure"
  },
  "8d157d49-93dd-4bc2-89d1-cb823c427a31": {
    "original": "04 - Mind Map",
    "label": "04 — Коридоры и горгульи — Mind Map"
  },
  "4f8f6cce-6a3f-4acb-acec-6ef92729816c": {
    "original": "03 - Is Someone There",
    "label": "03 — Речь под софитами — Is Someone There"
  },
  "affd8b04-a2b9-4f79-9868-6e915e1cf9af": {
    "original": "01 - Interior Jazz",
    "label": "01–02 — Бал, подготовка и эпилог — Interior Jazz"
  }
};
export function campaignAssetLabel<T extends { id: string; name: string }>(campaignId: string, asset: T): T {
  if (campaignId !== "eb6a55c4-a821-4739-8d4a-a1028e9d9092") return asset;
  const entry = amberionLabels[asset.id];
  if (!entry || asset.name !== entry.original) return asset;
  return { ...asset, name: entry.label };
}

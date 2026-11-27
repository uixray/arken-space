const messages: Record<string, string> = {
  CHARACTER_FORBIDDEN: "Нет доступа к этому персонажу.",
  CHARACTER_ENTRY_FORBIDDEN: "Нет доступа к этому умению или предмету.",
  CHARACTER_CONFLICT: "Персонаж изменился. Проверьте обновлённые значения и повторите действие.",
  ENTRY_CONFLICT: "Умение или предмет изменились. Проверьте обновлённые значения.",
  ENTRY_CONFLICT_TX: "Умение или предмет изменились. Проверьте обновлённые значения.",
  ACTION_ID_CONFLICT: "Это действие уже использовано с другими параметрами. Проверьте историю.",
  NO_ABILITY_USES: "Доступные применения закончились.",
  INSUFFICIENT_CHARACTER_RESOURCE: "Для действия недостаточно ресурса персонажа.",
  ENTRY_HAS_NO_USES: "У этого умения или предмета нет счётчика применений.",
  CREATION_RECHARGE_REQUIRES_GM: "Восстановить этот предмет может мастер.",
  ROLL_ACTION_NOT_FOUND: "Выбранное действие больше недоступно.",
  IMAGE_TOO_LARGE: "Изображение превышает допустимый размер.",
  IMAGE_DIMENSIONS_TOO_LARGE:
    "Изображение слишком большое по ширине или высоте.",
  INVALID_IMAGE:
    "Не удалось прочитать изображение. Выберите корректный PNG, JPEG или WebP.",
  UNSUPPORTED_FILE_TYPE: "Выберите изображение PNG, JPEG или WebP.",
  UNSUPPORTED_IMAGE_TYPE: "Выберите изображение PNG, JPEG или WebP.",
  LOW_DISK_SPACE: "В хранилище недостаточно свободного места.",
  MEDIA_QUOTA_EXCEEDED: "Достигнут лимит хранилища файлов.",
  UPLOAD_MEMORY_LIMIT:
    "Мастер обрабатывает другие изображения. Повторите загрузку позже.",
  PROCESSING_BUSY: "Обработка изображений занята. Повторите загрузку позже.",
  UPLOAD_RESTART_REQUIRED: "Передача прервалась. Выберите изображение заново.",
  UPLOAD_CONFLICT:
    "Параметры передачи изменились. Выберите изображение заново.",
  UPLOAD_OFFSET_INVALID:
    "Порядок передачи нарушен. Выберите изображение заново.",
  UPLOAD_HASH_MISMATCH:
    "Изображение передалось с ошибкой. Выберите его заново.",
  UPLOAD_CHUNK_INVALID: "Некорректные данные изображения. Выберите его заново.",
  UPLOAD_REQUIRED: "Выберите изображение.",
};
const translated=(code:string)=>Object.hasOwn(messages,code)?messages[code]:undefined;
export const peerCommandErrorMessage=(code:string)=>translated(code)??"Не удалось подтвердить действие. Проверьте состояние кампании.";
export const uploadCommandErrorMessage=(code:string)=>translated(code)??"Не удалось загрузить изображение.";

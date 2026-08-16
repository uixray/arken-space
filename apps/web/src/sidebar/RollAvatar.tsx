import type { PublicCharacterIdentityDto } from "@arken/contracts";
import { useState } from "react";
import { rollInitials } from "../roll-initials";

/**
 * UIX-454 — кто бросил кубик.
 *
 * Портрет персонажа, за которого бросают; если портрета нет — инициалы. Так
 * решил мастер: заглушка нужна для персонажа без картинки, а не для чужого
 * персонажа. Чужие теперь приходят игроку публичной личностью
 * (`characterIdentities`), и прежняя плашка со словом «Персонаж» — подпись,
 * которая занимала место и ничего не сообщала, — исчезает вместе с причиной.
 *
 * Броски без персонажа (мастер за себя, системные сообщения) берут инициалы от
 * имени участника: пустой кружок в ленте выглядел бы как сбой загрузки.
 */
export function RollAvatar({
  identity,
  fallbackName,
  assetUrl,
}: {
  identity: PublicCharacterIdentityDto | null;
  /** Имя участника — на случай броска без персонажа. */
  fallbackName: string;
  assetUrl: string | null;
}) {
  const name = identity?.name ?? fallbackName;
  const [failedAssetUrl, setFailedAssetUrl] = useState<string | null>(null);
  const showImage = assetUrl !== null && failedAssetUrl !== assetUrl;
  return (
    <span
      className="roll-avatar"
      // Имя в подсказке, а не подписью рядом: в узкой колонке подпись отняла бы
      // у результата броска половину строки.
      title={name}
    >
      {showImage ? (
        <img
          src={assetUrl}
          alt={name}
          loading="lazy"
          onError={() => setFailedAssetUrl(assetUrl)}
        />
      ) : (
        <span aria-hidden="true">{rollInitials(name)}</span>
      )}
      <span className="visually-hidden">{name}</span>
    </span>
  );
}

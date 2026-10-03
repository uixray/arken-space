import { memo, useRef } from "react";
import type { GameSnapshot } from "@arken/contracts";
import { useDismissibleDetails } from "./ui/dismissible-details";
import { AppIcon } from "./ui/AppIcon";
import { TokenTrayIcon } from "./ui/icons";

export interface TokenTrayProps {
  tokenDefinitions?: GameSnapshot["tokenDefinitions"];
  assets: GameSnapshot["assets"];
  role: GameSnapshot["me"]["role"];
  onPlaceToken: (definitionId: string) => void;
}

export const TokenTray = memo(function TokenTray({
  tokenDefinitions,
  assets,
  role,
  onPlaceToken,
}: TokenTrayProps) {
  const tokenTrayRef = useRef<HTMLDetailsElement>(null);
  useDismissibleDetails(tokenTrayRef);

  const definitions = tokenDefinitions ?? [];

  return (
    <details className="token-tray toolbar-detail" ref={tokenTrayRef}>
      <summary
        className="map-tool"
        aria-label={`Токены · ${definitions.length}`}
        title={`Токены · ${definitions.length}`}
        data-tool="TOKENS"
      >
        <AppIcon icon={TokenTrayIcon} />
        <span className="map-tool__label">Токены</span>
      </summary>
      <div className="token-tray-list">
        {definitions.length === 0 && (
          <p className="muted">
            {role === "GM"
              ? "Создайте токен персонажа в подготовке."
              : "Мастер ещё не назначил вам доступные токены."}
          </p>
        )}
        {definitions.map((definition) => {
          const asset = assets.find(
            (item) => item.id === definition.defaultAssetId,
          );
          return (
            <button
              key={definition.id}
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData(
                  "application/x-arken-token-definition",
                  definition.id,
                )
              }
              onClick={() => onPlaceToken(definition.id)}
            >
              {asset ? (
                <img src={asset.url} alt="" />
              ) : (
                <span aria-hidden="true">
                  {definition.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <strong>{definition.name}</strong>
            </button>
          );
        })}
      </div>
    </details>
  );
});

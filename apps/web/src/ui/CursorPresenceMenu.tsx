import { useState } from "react";
import { Popup, Switch } from "@gravity-ui/uikit";
import type { CursorPreference } from "../cursor-preference";

/**
 * UIX-403: cursor visibility, which is one setting for a player and two for a
 * GM.
 *
 * A player gets a plain toggle for other people's cursors. The second switch
 * exists in the data model but has nothing to offer them: their own cursor is
 * never drawn back to them, and unlike a GM they have nothing to hide — a
 * player's pointer only ever moves over what the players can already see. A
 * menu holding one switch is two clicks for a job the toolbar does in one, so
 * they do not get a menu at all.
 *
 * A GM keeps the menu, because for them the sending switch is a real decision:
 * it shows the players where they are pointing, fog included.
 */
export function CursorPresenceMenu({
  preference,
  role,
  onChange,
}: {
  preference: CursorPreference;
  role: "GM" | "PLAYER";
  onChange: (next: CursorPreference) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  if (role !== "GM")
    return (
      <button
        type="button"
        title={
          preference.receiveEnabled
            ? "Скрыть курсоры остальных"
            : "Показывать курсоры остальных"
        }
        className="map-tool"
        data-tool="CURSOR_PRESENCE"
        aria-pressed={preference.receiveEnabled}
        onClick={() =>
          onChange({
            ...preference,
            receiveEnabled: !preference.receiveEnabled,
          })
        }
      >
        Курсоры
      </button>
    );

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Настроить видимость курсоров"
        className="map-tool"
        data-tool="CURSOR_PRESENCE"
        onClick={() => setOpen((value) => !value)}
      >
        Курсоры
      </button>
      <Popup
        open={open}
        onOpenChange={setOpen}
        anchorElement={anchor}
        placement="bottom-start"
      >
        <div className="cursor-presence-menu" role="group">
          <Switch
            checked={preference.receiveEnabled}
            onUpdate={(receiveEnabled) =>
              onChange({ ...preference, receiveEnabled })
            }
          >
            Показывать чужие курсоры
          </Switch>
          <Switch
            checked={preference.sendEnabled}
            onUpdate={(sendEnabled) => onChange({ ...preference, sendEnabled })}
          >
            Показывать мой курсор игрокам
          </Switch>
          <p className="cursor-presence-menu__note">
            Игроки увидят, куда вы указываете, — в том числе на скрытых туманом
            участках карты.
          </p>
        </div>
      </Popup>
    </>
  );
}

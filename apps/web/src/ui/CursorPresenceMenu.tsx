import { useState } from "react";
import { Popup, Switch } from "@gravity-ui/uikit";
import type { CursorPreference } from "../cursor-preference";

/**
 * UIX-403: the two cursor settings, which until now shared one button that
 * flipped both at once.
 *
 * They answer different questions — "should the others see me" and "should I
 * see the others" — and a single control could not express, say, "watch
 * everyone but stay invisible myself". The map toolbar has no room for two
 * more buttons, so they live behind one.
 *
 * The sending switch reads differently by role on purpose. A player's cursor
 * has always gone to the whole campaign; a GM's has gone to the GM room alone,
 * because a GM sees through fog and their pointer would give away what is
 * under it. So for a GM this switch is the deliberate act of pointing at
 * something in front of the players, and its label says exactly that.
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
  const isGm = role === "GM";

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-label="Курсоры участников"
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
            {isGm ? "Показывать мой курсор игрокам" : "Показывать мой курсор"}
          </Switch>
          {isGm && (
            <p className="cursor-presence-menu__note">
              Игроки увидят, куда вы указываете, — в том числе на скрытых
              туманом участках карты.
            </p>
          )}
        </div>
      </Popup>
    </>
  );
}

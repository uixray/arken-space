import { useEffect, useRef, useState } from "react";
import { Button } from "./design-system/Button";
import { FormInput } from "./ui/GravityFormControls";

/** Invitation secrets stay in component memory and a manually selectable field. */
export function AccountInviteLink({ url, campaignName, recipient, focusResult = false }: {
  url: string; campaignName: string; recipient: string; focusResult?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const result = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (focusResult && result.current !== document.activeElement) result.current?.focus(); }, [focusResult]);
  return <section ref={result} tabIndex={-1} className="account-invite-link" aria-label={`Приглашение игроку ${recipient} в кампанию ${campaignName}`}>
    <p>Кампания: <strong>{campaignName}</strong>. Игрок: <strong>{recipient}</strong>.</p>
    <label>Личная ссылка (действует до 72 часов)
      <FormInput controlRef={input} type="text" value={url} readOnly autoComplete="off" spellCheck={false}
        onFocus={event => event.currentTarget.select()} />
    </label>
    <Button type="button" disabled={busy} onClick={async () => {
      if (pending.current) return;
      pending.current = true; setBusy(true); setNotice("");
      try {
        if (!navigator.clipboard?.writeText) throw new Error("MANUAL_COPY");
        await navigator.clipboard.writeText(url);
        if (alive.current) setNotice("Ссылка скопирована. Передайте её игроку лично.");
      } catch {
        if (alive.current) {
          input.current?.focus(); input.current?.select();
          setNotice("Ссылка выделена. Скопируйте её через меню браузера или сочетанием клавиш и передайте игроку лично.");
        }
      } finally {
        pending.current = false; if (alive.current) setBusy(false);
      }
    }}>Скопировать приглашение</Button>
    <p>Ссылка предоставляет доступ к кампании. Отправляйте её лично нужному игроку.</p>
    <p role="status" aria-live="polite">{notice}</p>
  </section>;
}

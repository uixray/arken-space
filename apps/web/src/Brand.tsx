/** UIX-506: accepted A2/B2 + temporary Yeseva One. The surrounding link owns
 * its accessible name; the lockup is decorative, never a second navigation item. */
export function Brand({ compact = false }: { compact?: boolean }) {
  const mark = <span className="brand__mark" aria-hidden="true" />;
  if (compact) return mark;
  return (
    <span className="brand-lockup" aria-hidden="true">
      {mark}
      <span className="brand__wordmark">Аркспейс</span>
    </span>
  );
}

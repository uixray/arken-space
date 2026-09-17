import { useCallback, useState } from "react";
import { volumeSliderToGain } from "../audio-volume";

/** Local audition only: never sends campaign audio commands or saves consent. */
export function AssetAudioPreview({
  url,
  name,
}: {
  url: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const initialize = useCallback((element: HTMLAudioElement | null) => {
    if (!element) return;
    let slider = 0.5;
    try {
      const stored = localStorage.getItem("arken.audio.volume");
      const value = stored === null ? NaN : Number(stored);
      if (Number.isFinite(value) && value >= 0 && value <= 1) slider = value;
    } catch {
      // Storage may be unavailable; preview still starts at a modest gain.
    }
    element.volume = volumeSliderToGain(slider);
  }, []);

  return (
    <div className="asset-audio-preview">
      <small>Только для вас. Нажмите воспроизведение для прослушивания.</small>
      <audio
        ref={initialize}
        aria-label={`Прослушивание: ${name}`}
        controls
        preload="none"
        src={url}
        onError={() => setFailed(true)}
      />
      {failed && (
        <span className="field-error" role="alert">
          Не удалось воспроизвести файл. Закройте превью и попробуйте снова.
        </span>
      )}
    </div>
  );
}

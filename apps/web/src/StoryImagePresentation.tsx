import { useEffect, useRef, useState } from "react";
import type { StoryChangedEvent } from "@arken/contracts";
import type { GameSocket } from "./realtime";
import "./StoryImagePresentation.css";

type Presentation = NonNullable<StoryChangedEvent["presentation"]>;
const OPEN_EVENT = "arken:open-story-image";
export function openStoryImage(presentation: Presentation) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: presentation }));
}

export function StoryImagePresentation({ socket, campaignId, enabled }: {
  socket: GameSocket | null; campaignId: string; enabled: boolean;
}) {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const seen = useRef(new Set<string>());
  const allowed = enabled && campaignId === "eb6a55c4-a821-4739-8d4a-a1028e9d9092";
  useEffect(() => {
    seen.current.clear();
    setPresentation(null);
  }, [campaignId, enabled]);
  useEffect(() => {
    if (!allowed) return;
    const show = (next: Presentation) => {
      if (!next.media.length) return;
      setIndex(0); setFailed(false); setPresentation(next);
    };
    const onPublished = (event: StoryChangedEvent) => {
      if (event.campaignId !== campaignId || !event.presentation || seen.current.has(event.presentation.key)) return;
      seen.current.add(event.presentation.key);
      show(event.presentation);
    };
    const onOpen = (event: Event) => show((event as CustomEvent<Presentation>).detail);
    socket?.on("story:changed", onPublished);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      socket?.off("story:changed", onPublished);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [socket, campaignId, allowed]);
  useEffect(() => {
    const element = dialog.current;
    if (presentation && allowed) {
      if (element && !element.open) element.showModal();
    } else if (element?.open) element.close();
  }, [presentation, allowed]);
  if (!allowed) return null;
  const media = presentation?.media[index];
  const close = () => setPresentation(null);
  return (
    <dialog ref={dialog} className="story-presentation" aria-labelledby="story-presentation-title"
      onCancel={event => { event.preventDefault(); close(); }}
      onClose={close}>
      <header>
        <h2 id="story-presentation-title">{presentation?.title}</h2>
        <button type="button" autoFocus onClick={close} aria-label="Закрыть изображение">Закрыть ×</button>
      </header>
      <div className="story-presentation__image">
        {media && !failed && <img key={media.contentId} src={`/api/story/media/${media.contentId}`}
          alt={media.altText} onError={() => setFailed(true)} />}
        {failed && <p role="alert">Изображение не загрузилось. <button type="button" onClick={() => setFailed(false)}>Повторить</button></p>}
      </div>
      <footer>
        <span>{media?.caption}</span>
        {presentation && presentation.media.length > 1 && <nav aria-label="Изображения публикации">
          <button type="button" disabled={index === 0} onClick={() => { setFailed(false); setIndex(index - 1); }}>Назад</button>
          <span>{index + 1} / {presentation.media.length}</span>
          <button type="button" disabled={index === presentation.media.length - 1} onClick={() => { setFailed(false); setIndex(index + 1); }}>Далее</button>
        </nav>}
      </footer>
    </dialog>
  );
}

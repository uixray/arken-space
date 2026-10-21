import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/Button";
import { AppIcon } from "./AppIcon";
import {
  CloseIcon,
  InfoNoticeIcon,
  SuccessNoticeIcon,
  WarningNoticeIcon,
  type LucideIcon,
} from "./icons";
import { appToaster, type ToastEntry, type Toaster } from "./toaster";
import "./toaster.css";

const DEFAULT_TIMEOUT = 5000;
const EXIT_FALLBACK_MS = 700;

const THEME_ICONS: Partial<Record<string, LucideIcon>> = {
  info: InfoNoticeIcon,
  success: SuccessNoticeIcon,
  warning: WarningNoticeIcon,
  danger: WarningNoticeIcon,
};

/**
 * UIX-709: renders `appToaster` in a body portal (the former Gravity toaster
 * markup and class names, so existing styles and checks keep their hooks).
 * A removed toast plays its exit animation before it leaves the DOM.
 */
export function AppToaster({ toaster = appToaster }: { toaster?: Toaster }) {
  const toasts = useSyncExternalStore(
    toaster.subscribe,
    toaster.getSnapshot,
    toaster.getSnapshot,
  );
  const [leaving, setLeaving] = useState<ToastEntry[]>([]);
  const previous = useRef<readonly ToastEntry[]>(toasts);

  useLayoutEffect(() => {
    const current = new Set(toasts.map(keyOf));
    const removed = previous.current.filter(
      (toast) => !current.has(keyOf(toast)),
    );
    previous.current = toasts;
    if (removed.length > 0) setLeaving((list) => [...list, ...removed]);
  }, [toasts]);

  const rendered = [...toasts, ...leaving].sort(
    (left, right) => left.addedAt - right.addedAt,
  );
  const leavingKeys = new Set(leaving.map(keyOf));

  return createPortal(
    <div className="arken-toaster" aria-live="assertive">
      {rendered.map((toast) => (
        <Toast
          key={keyOf(toast)}
          toast={toast}
          leaving={leavingKeys.has(keyOf(toast))}
          onClose={() => toaster.remove(toast.name)}
          onLeft={() =>
            setLeaving((list) =>
              list.filter((entry) => keyOf(entry) !== keyOf(toast)),
            )
          }
        />
      ))}
    </div>,
    document.body,
  );
}

function keyOf(toast: ToastEntry) {
  return `${toast.name}_${toast.addedAt}`;
}

function Toast({
  toast,
  leaving,
  onClose,
  onLeft,
}: {
  toast: ToastEntry;
  leaving: boolean;
  onClose: () => void;
  onLeft: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [entering, setEntering] = useState(true);
  const [hovered, setHovered] = useState(false);
  // Parents pass fresh callbacks on every render; timers must not restart.
  const callbacks = useRef({ onClose, onLeft });
  useLayoutEffect(() => {
    callbacks.current = { onClose, onLeft };
  });
  const theme = toast.theme ?? "normal";
  const timeout =
    toast.autoHiding === false ? null : (toast.autoHiding ?? DEFAULT_TIMEOUT);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element)
      element.style.setProperty(
        "--_--item-height",
        `${element.offsetHeight}px`,
      );
    setEntering(false);
  }, []);

  useEffect(() => {
    if (leaving || hovered || timeout === null) return;
    const timer = window.setTimeout(() => callbacks.current.onClose(), timeout);
    return () => window.clearTimeout(timer);
  }, [leaving, hovered, timeout]);

  useEffect(() => {
    if (!leaving) return;
    const element = ref.current;
    if (element)
      element.style.setProperty(
        "--_--item-height",
        `${element.offsetHeight}px`,
      );
    const left = () => callbacks.current.onLeft();
    const ownAnimationEnded = (event: AnimationEvent) => {
      if (event.target === element) left();
    };
    const timer = window.setTimeout(left, EXIT_FALLBACK_MS);
    element?.addEventListener("animationend", ownAnimationEnded);
    return () => {
      window.clearTimeout(timer);
      element?.removeEventListener("animationend", ownAnimationEnded);
    };
  }, [leaving]);

  const icon = THEME_ICONS[theme];
  const animation = leaving
    ? "arken-toast-animation-desktop--exit-active"
    : entering
      ? "arken-toast-animation-desktop--enter"
      : "arken-toast-animation-desktop--enter-active";

  return (
    <div
      ref={ref}
      className={`arken-toast arken-toast--theme-${theme} ${animation}`}
      data-toast
      onMouseOver={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {icon ? (
        <div className="arken-toast__icon-container">
          <AppIcon
            icon={icon}
            size={20}
            className={`arken-toast__icon arken-toast__icon--${theme}`}
          />
        </div>
      ) : null}
      <div className="arken-toast__container">
        {toast.title ? (
          <h3 className="arken-toast__title">{toast.title}</h3>
        ) : null}
        {toast.isClosable !== false ? (
          <Button
            size="s"
            view="flat"
            className="arken-toast__btn-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <span className="arken-button__icon" aria-hidden="true">
              <span className="arken-button__icon-inner">
                <AppIcon icon={CloseIcon} />
              </span>
            </span>
          </Button>
        ) : null}
        {toast.content ? (
          <div
            className={
              toast.title
                ? "arken-toast__content"
                : "arken-toast__content arken-toast__content--without-title"
            }
          >
            {toast.content}
          </div>
        ) : null}
      </div>
    </div>
  );
}

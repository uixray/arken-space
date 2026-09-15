import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

/** Local popup ownership only. Submission/draft ownership stays with callers. */
export function useComposerSuggestions(
  scope: string,
  hasTypedSuggestions: boolean,
  enabled = true,
) {
  const [state, setState] = useState({
    scope,
    explicit: false,
    suppressed: false,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const originRef = useRef<"trigger" | "typed">("typed");
  const composingRef = useRef(false);
  const visible =
    enabled &&
    state.scope === scope &&
    (state.explicit || (hasTypedSuggestions && !state.suppressed));

  useLayoutEffect(() => {
    composingRef.current = false;
    originRef.current = "typed";
    setState({ scope, explicit: false, suppressed: true });
  }, [scope]);

  const dismiss = () => {
    setState({ scope, explicit: false, suppressed: true });
  };
  const edited = () => {
    originRef.current = "typed";
    setState({ scope, explicit: false, suppressed: false });
  };
  const toggle = () => {
    if (visible) dismiss();
    else {
      originRef.current = "trigger";
      setState({ scope, explicit: true, suppressed: false });
    }
  };
  const focusTextarea = () =>
    textareaRef.current?.focus({ preventScroll: true });
  const complete = () => {
    dismiss();
    focusTextarea();
  };

  useEffect(() => {
    if (!visible) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setState({ scope, explicit: false, suppressed: true });
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [visible, scope]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!visible || event.defaultPrevented) return;
    const composing = event.nativeEvent.isComposing || composingRef.current;
    // Native buttons must not activate a command while IME owns Enter/Space.
    if (composing) {
      if (
        (event.key === "Enter" || event.key === " ") &&
        (event.target as Element).closest('[role="option"]')
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      if (originRef.current === "trigger") {
        rootRef.current
          ?.querySelector<HTMLButtonElement>(".composer-slash-action")
          ?.focus({ preventScroll: true });
      } else focusTextarea();
      return;
    }
    const target = event.target as Element;
    const optionTarget = target.closest('[role="option"]');
    const isTextarea = target === textareaRef.current;
    const isTrigger = Boolean(target.closest(".composer-slash-action"));
    if (!optionTarget && !isTextarea && !isTrigger) return;
    // Home/End retain native caret behavior outside the option list.
    if ((event.key === "Home" || event.key === "End") && !optionTarget) return;
    const options = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ??
        [],
    );
    if (!options.length) return;
    const current = options.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else if (event.key === "ArrowDown") next = (current + 1) % options.length;
    else if (event.key === "ArrowUp")
      next = current <= 0 ? options.length - 1 : current - 1;
    else return; // Native Tab and option Enter/Space stay native, exactly once.
    event.preventDefault();
    event.stopPropagation();
    options[next]?.focus({ preventScroll: true });
  };

  return {
    rootRef,
    textareaRef,
    visible,
    explicit: state.scope === scope && state.explicit,
    edited,
    toggle,
    dismiss,
    complete,
    onKeyDown,
    isComposing: (event: KeyboardEvent<HTMLTextAreaElement>) =>
      event.nativeEvent.isComposing || composingRef.current,
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
    },
  };
}

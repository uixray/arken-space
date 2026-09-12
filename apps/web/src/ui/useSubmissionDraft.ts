import { useLayoutEffect, useRef, useState } from "react";

export type SubmissionDraftToken = Readonly<{
  generation: number;
  scope: string;
  scopeEpoch: number;
}>;

/**
 * Consumes a draft immediately while an async submission is in flight.
 * A failed submission may restore only the exact, still-untouched empty slot
 * it consumed; later typing, an intentional clear, another submit, a scope
 * change, or unmount permanently invalidates the token.
 */
export function useSubmissionDraft(scope: string) {
  const [value, setStoredValue] = useState("");
  const valueRef = useRef(value);
  const generationRef = useRef(0);
  const scopeRef = useRef(scope);
  const scopeEpochRef = useRef(0);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    if (scopeRef.current === scope) return;
    scopeRef.current = scope;
    scopeEpochRef.current += 1;
    generationRef.current += 1;
  }, [scope]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeEpochRef.current += 1;
      generationRef.current += 1;
    };
  }, []);

  const setValue = (next: string) => {
    generationRef.current += 1;
    valueRef.current = next;
    setStoredValue(next);
  };

  const touch = () => {
    generationRef.current += 1;
    return {
      generation: generationRef.current,
      scope: scopeRef.current,
      scopeEpoch: scopeEpochRef.current,
    } satisfies SubmissionDraftToken;
  };

  const consume = (): { value: string; token: SubmissionDraftToken } => {
    const consumed = valueRef.current;
    const token = {
      generation: generationRef.current + 1,
      scope: scopeRef.current,
      scopeEpoch: scopeEpochRef.current,
    };
    generationRef.current = token.generation;
    valueRef.current = "";
    setStoredValue("");
    return { value: consumed, token };
  };

  const isUntouched = (token: SubmissionDraftToken) =>
    mountedRef.current &&
    scopeRef.current === token.scope &&
    generationRef.current === token.generation &&
    valueRef.current === "";

  const isCurrentScope = (token: SubmissionDraftToken) =>
    mountedRef.current &&
    scopeRef.current === token.scope &&
    scopeEpochRef.current === token.scopeEpoch;

  const restore = (token: SubmissionDraftToken, consumed: string) => {
    if (!isUntouched(token)) return false;
    generationRef.current += 1;
    valueRef.current = consumed;
    setStoredValue(consumed);
    return true;
  };

  return {
    value,
    setValue,
    touch,
    consume,
    restore,
    isUntouched,
    isCurrentScope,
  };
}

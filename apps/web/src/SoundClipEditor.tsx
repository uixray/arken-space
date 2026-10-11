import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetDto, AudioClipAnalysis } from "@arken/contracts";
import { ApiError } from "./api.js";
import type { ClipCandidateStatus } from "./sound-clip-api.js";
import {
  audioClipPreviewContentUrl,
  createAudioClipPreview,
  getAudioClipAnalysis,
  getAudioClipCandidate,
  saveAudioClip,
} from "./sound-clip-api.js";
import {
  clampClipRange,
  createClipEditorState,
  currentReadyCandidate,
  ensurePreviewActionId,
  ensureSaveActionId,
  rangeIntentKey,
  validateClipRange,
  withAnalysis,
  withCandidate,
  withRange,
  withoutCandidate,
  type ClipEditorState,
} from "./sound-clip-editor-state.js";
import "./SoundClipEditor.css";

type Props = {
  source: AssetDto;
  packId: string;
  sourceNote: string;
  onSaved: () => Promise<void> | void;
  onClose: () => void;
};

function newActionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatTime(ms: number) {
  const wholeSeconds = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}.${tenths}`;
}

function errorText(error: unknown) {
  const code =
    error instanceof ApiError
      ? error.code
      : error instanceof Error
        ? error.message
        : "";
  const messages: Record<string, string> = {
    INVALID_RANGE:
      "Сервер отклонил границы отрезка. Проверьте значения и повторите.",
    UNSUPPORTED_AUDIO: "Этот формат или профиль пока нельзя обработать.",
    SOURCE_NOT_FOUND: "Исходный файл больше недоступен.",
    SOURCE_STALE:
      "Исходный файл изменился. Закройте редактор и начните заново.",
    QUOTA_EXCEEDED: "Недостаточно места в хранилище кампании.",
    MEDIA_QUOTA_EXCEEDED: "Недостаточно места в хранилище кампании.",
    PROCESSING_OUTPUT_LIMIT: "Фрагмент превышает допустимый лимит обработки.",
    ANALYSIS_RESOURCE_LIMIT:
      "Источник слишком велик для анализа в текущих ограничениях.",
    CODEC_UNAVAILABLE: "Формат аудио не поддерживается сервером обработки.",
    INVALID_COMMAND: "Не удалось запустить безопасную обработку аудио.",
    LOW_DISK_SPACE: "Обработка временно недоступна из-за места на сервере.",
    PROCESSING_BUSY: "Сервер занят. Повторите действие чуть позже.",
    PROCESSING_TIMEOUT:
      "Обработка заняла слишком долго. Можно безопасно повторить.",
    CANDIDATE_EXPIRED: "Предпросмотр истёк. Создайте его заново.",
    ACTION_CONFLICT:
      "Действие уже отправлено с другими параметрами. Создайте новый предпросмотр.",
    CANDIDATE_NOT_FOUND: "Предпросмотр больше недоступен.",
    FAILED:
      "Не удалось обработать этот отрезок. Проверьте формат источника и попробуйте другой диапазон.",
    GM_REQUIRED: "Редактировать эффекты может только ведущий.",
  };
  return messages[code] ?? "Не удалось выполнить операцию. Повторите попытку.";
}

export function SoundClipEditor({
  source,
  packId,
  sourceNote,
  onSaved,
  onClose,
}: Props) {
  const [state, setState] = useState<ClipEditorState>(() =>
    createClipEditorState(source.id),
  );
  const [analysis, setAnalysis] = useState<AudioClipAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [label, setLabel] = useState(source.name.replace(/\.[^.]+$/, ""));
  const [icon, setIcon] = useState("🔊");
  const [category, setCategory] = useState("Другое");
  const [audience, setAudience] = useState<"ALL_MEMBERS" | "GM_ONLY">(
    "ALL_MEMBERS",
  );
  const [sourceNoteValue, setSourceNoteValue] = useState(sourceNote);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const attachAudioRef = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    audioRef.current = audio;
  }, []);
  const waveformRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const operationRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    setBusy(true);
    setAnalysis(null);
    setState(createClipEditorState(source.id));
    setLabel(source.name.replace(/\.[^.]+$/, ""));
    setSourceNoteValue(sourceNote);
    setError("");
    setNotice("");
    setSaved(false);
    setAnalysisError("");
    void getAudioClipAnalysis(source.id, controller.signal)
      .then((value) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        if (value.sourceAssetId !== source.id) {
          setAnalysisError("Сервер вернул анализ другого исходного файла.");
          return;
        }
        setAnalysis(value);
        setState((current) => withAnalysis(current, value));
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && mountedRef.current)
          setAnalysisError(errorText(reason));
      })
      .finally(() => {
        if (mountedRef.current && !controller.signal.aborted) setBusy(false);
      });
    return () => {
      mountedRef.current = false;
      controller.abort();
      operationRef.current?.abort();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    };
  }, [source.id]);

  const candidate = currentReadyCandidate(state);
  const durationMs = analysis?.durationMs ?? null;
  const rangeError = validateClipRange(
    state.range.startMs,
    state.range.endMs,
    durationMs,
  );
  const selectedRange = useMemo(() => {
    if (!durationMs) return { start: 0, end: 0 };
    return {
      start: (state.range.startMs / durationMs) * 100,
      end: (state.range.endMs / durationMs) * 100,
    };
  }, [durationMs, state.range.startMs, state.range.endMs]);
  const previewSource = candidate
    ? audioClipPreviewContentUrl(candidate.previewUrl, candidate.candidateId)
    : "";

  useEffect(() => {
    setPlaying(false);
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
  }, [
    state.sourceAssetId,
    state.range.startMs,
    state.range.endMs,
    candidate?.candidateId,
  ]);

  const changeRange = (
    endpoint: "startMs" | "endMs",
    value: number,
    allowFraction = false,
  ) => {
    if (durationMs === null || !Number.isFinite(value)) return;
    setNotice("");
    setError("");
    setState((current) => {
      if (allowFraction) {
        const rawRange = { ...current.range, [endpoint]: value };
        return withRange(current, rawRange);
      }
      return withRange(
        current,
        clampClipRange(current.range, durationMs, endpoint, value),
      );
    });
  };

  const handleMarkerKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    endpoint: "startMs" | "endMs",
  ) => {
    if (!durationMs) return;
    const step = event.shiftKey ? 1000 : 100;
    const current = state.range[endpoint];
    const max =
      endpoint === "startMs"
        ? state.range.endMs - 1
        : Math.min(durationMs, state.range.startMs + 10_000);
    const min =
      endpoint === "startMs"
        ? Math.max(0, state.range.endMs - 10_000)
        : state.range.startMs + 1;
    let next = current;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp")
      next += step;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    changeRange(endpoint, Math.max(min, Math.min(max, next)));
  };

  const movePointerMarker = (
    event: React.PointerEvent<HTMLButtonElement>,
    endpoint: "startMs" | "endMs",
  ) => {
    if (!durationMs || !waveformRef.current) return;
    const bounds = waveformRef.current.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const fraction = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    changeRange(endpoint, fraction * durationMs);
  };

  const generatePreview = async () => {
    if (!analysis || rangeError || busy) return;
    setError("");
    setNotice("");
    const intent = rangeIntentKey(state);
    if (!intent) return;
    const controller = new AbortController();
    operationRef.current?.abort();
    operationRef.current = controller;
    const withAction = ensurePreviewActionId(state, newActionId);
    setState(withAction);
    setBusy(true);
    try {
      const request = await createAudioClipPreview(
        source.id,
        {
          actionId: withAction.previewActionId!,
          sourceVersion: analysis.sourceVersion,
          startMs: withAction.range.startMs,
          endMs: withAction.range.endMs,
        },
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      let latest: ClipCandidateStatus = request;
      const deadline = Date.now() + 60_000;
      while (latest.status === "PROCESSING" && Date.now() < deadline) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 700));
        if (controller.signal.aborted) return;
        latest = await getAudioClipCandidate(
          request.candidateId,
          controller.signal,
        );
      }
      if (!mountedRef.current || controller.signal.aborted) return;
      setState((current) => {
        if (rangeIntentKey(current) !== intent) return current;
        return withCandidate(current, latest);
      });
      if (latest.status === "READY")
        setNotice("Предпросмотр готов. Проверьте звук перед сохранением.");
      else if (latest.status === "PROCESSING")
        setError("Обработка ещё выполняется. Повторите проверку позже.");
      else
        setError(
          errorText(
            new Error(
              latest.status === "EXPIRED" ? "CANDIDATE_EXPIRED" : latest.status,
            ),
          ),
        );
    } catch (reason) {
      if (!controller.signal.aborted && mountedRef.current) {
        if (
          reason instanceof ApiError &&
          ["CANDIDATE_EXPIRED", "CANDIDATE_NOT_FOUND", "SOURCE_STALE"].includes(
            reason.code,
          )
        )
          setState((current) => withoutCandidate(current));
        setError(errorText(reason));
      }
    } finally {
      if (operationRef.current === controller) operationRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) setBusy(false);
    }
  };

  const refreshSavedCatalog = async () => {
    setBusy(true);
    setError("");
    try {
      await onSaved();
      if (mountedRef.current) onClose();
    } catch {
      if (mountedRef.current)
        setError(
          "Эффект сохранён, но каталог не обновился. Повторите обновление.",
        );
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const saveCurrent = async () => {
    if (!analysis || !candidate || !label.trim() || busy || saved) return;
    setError("");
    setNotice("");
    const intent = JSON.stringify({
      candidateId: candidate.candidateId,
      label: label.trim(),
      icon: icon.trim(),
      category: category.trim(),
      audience,
      sourceNote: sourceNoteValue.trim() || null,
    });
    const withAction = ensureSaveActionId(state, intent, newActionId);
    setState(withAction);
    const controller = new AbortController();
    operationRef.current?.abort();
    operationRef.current = controller;
    setBusy(true);
    try {
      await saveAudioClip(
        packId,
        {
          actionId: withAction.saveActionId!,
          candidateId: candidate.candidateId,
          label: label.trim(),
          icon: icon.trim() || "🔊",
          category: category.trim() || "Другое",
          defaultGain: 0.5,
          audience,
          sourceNote: sourceNoteValue.trim() || null,
        },
        controller.signal,
      );
    } catch (reason) {
      if (!controller.signal.aborted && mountedRef.current) {
        if (
          reason instanceof ApiError &&
          ["CANDIDATE_EXPIRED", "CANDIDATE_NOT_FOUND", "SOURCE_STALE"].includes(
            reason.code,
          )
        )
          setState((current) => withoutCandidate(current));
        setError(errorText(reason));
      }
      if (operationRef.current === controller) operationRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) setBusy(false);
      return;
    }
    if (operationRef.current === controller) operationRef.current = null;
    if (!mountedRef.current || controller.signal.aborted) return;
    setSaved(true);
    setState((current) => withoutCandidate(current));
    setNotice("Эффект сохранён в пак.");
    await refreshSavedCatalog();
  };
  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!candidate || !audio) return;
    setError("");
    if (!audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setError(
        "Браузер не смог воспроизвести предпросмотр. Попробуйте ещё раз.",
      );
    }
  };

  const markerPosition = (value: number) =>
    durationMs
      ? `${Math.max(0, Math.min(100, (value / durationMs) * 100))}%`
      : "0%";

  return (
    <section
      className="sound-clip-editor"
      aria-label="Редактор звукового эффекта"
    >
      <div className="sound-clip-editor__topline">
        <div>
          <h3>Создать эффект из аудио</h3>
          <p className="sound-clip-editor__source">Источник: {source.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть редактор эффекта"
        >
          Закрыть
        </button>
      </div>
      {analysisError && (
        <p className="sound-clip-editor__error" role="alert">
          {analysisError}
        </p>
      )}
      {busy && !analysis && <p role="status">Анализируем аудио…</p>}
      {analysis && (
        <>
          <div
            className="sound-clip-editor__meta"
            aria-label="Параметры источника"
          >
            <span>Длительность {formatTime(analysis.durationMs)}</span>
            <span>{analysis.sampleRate.toLocaleString("ru-RU")} Гц</span>
            <span>{analysis.channels} канала</span>
          </div>
          <div className="sound-clip-editor__waveform-wrap">
            <div className="sound-clip-editor__waveform-label">
              <span>Волновая форма</span>
              <span>Перетащите маркеры или задайте миллисекунды</span>
            </div>
            <div
              className="sound-clip-editor__waveform"
              data-waveform
              ref={waveformRef}
            >
              <svg
                viewBox="0 0 1000 100"
                preserveAspectRatio="none"
                role="img"
                aria-label="Волновая форма, рассчитанная по исходному аудио"
              >
                <line
                  x1="0"
                  y1="50"
                  x2="1000"
                  y2="50"
                  className="sound-clip-editor__baseline"
                />
                {analysis.peaks.map((peak, index) => {
                  const height = Math.max(1, peak * 44);
                  return (
                    <rect
                      key={index}
                      x={(index * 1000) / analysis.peaks.length}
                      y={50 - height}
                      width={Math.max(
                        0.7,
                        (1000 / analysis.peaks.length) * 0.64,
                      )}
                      height={height * 2}
                      rx="1"
                      className={
                        (index / analysis.peaks.length) * analysis.durationMs >=
                          state.range.startMs &&
                        (index / analysis.peaks.length) * analysis.durationMs <=
                          state.range.endMs
                          ? "sound-clip-editor__peak sound-clip-editor__peak--selected"
                          : "sound-clip-editor__peak"
                      }
                    />
                  );
                })}
                <rect
                  x={0}
                  y={0}
                  width={selectedRange.start}
                  height={100}
                  className="sound-clip-editor__dim"
                />
                <rect
                  x={selectedRange.end}
                  y={0}
                  width={1000 - selectedRange.end}
                  height={100}
                  className="sound-clip-editor__dim"
                />
              </svg>
              <button
                type="button"
                disabled={busy}
                className="sound-clip-editor__marker sound-clip-editor__marker--start"
                style={{ left: markerPosition(state.range.startMs) }}
                role="slider"
                aria-label="Начало отрезка"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, state.range.endMs - 1)}
                aria-valuenow={state.range.startMs}
                aria-valuetext={formatTime(state.range.startMs)}
                onKeyDown={(event) => handleMarkerKey(event, "startMs")}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  movePointerMarker(event, "startMs");
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    movePointerMarker(event, "startMs");
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
              >
                {" "}
                <span>Начало</span>
              </button>
              <button
                type="button"
                disabled={busy}
                className="sound-clip-editor__marker sound-clip-editor__marker--end"
                style={{ left: markerPosition(state.range.endMs) }}
                role="slider"
                aria-label="Конец отрезка"
                aria-valuemin={state.range.startMs + 1}
                aria-valuemax={Math.floor(durationMs ?? 0)}
                aria-valuenow={state.range.endMs}
                aria-valuetext={formatTime(state.range.endMs)}
                onKeyDown={(event) => handleMarkerKey(event, "endMs")}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  movePointerMarker(event, "endMs");
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    movePointerMarker(event, "endMs");
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
              >
                {" "}
                <span>Конец</span>
              </button>
            </div>
          </div>
          {candidate?.range && (
            <p className="sound-clip-editor__hint">
              Границы по кадрам: {candidate.range.actualStartFrame}–
              {candidate.range.actualEndFrame} при {candidate.range.sampleRate}{" "}
              Гц ({String(candidate.range.actualStartMs)}–
              {String(candidate.range.actualEndMs)} мс)
            </p>
          )}
          <div className="sound-clip-editor__range">
            <label>
              Начало, мс
              <input
                aria-label="Начало, миллисекунды"
                type="number"
                disabled={busy}
                min={0}
                max={Math.max(0, state.range.endMs - 1)}
                step={100}
                value={state.range.startMs}
                onChange={(event) =>
                  changeRange("startMs", Number(event.target.value), true)
                }
              />
            </label>
            <label>
              Конец, мс
              <input
                aria-label="Конец, миллисекунды"
                type="number"
                disabled={busy}
                min={state.range.startMs + 1}
                max={Math.floor(durationMs ?? 0)}
                step={100}
                value={state.range.endMs}
                onChange={(event) =>
                  changeRange("endMs", Number(event.target.value), true)
                }
              />
            </label>
            <p className="sound-clip-editor__range-summary">
              Выбрано: {formatTime(state.range.startMs)}–
              {formatTime(state.range.endMs)} (
              {Math.max(0, state.range.endMs - state.range.startMs)} мс)
            </p>
          </div>
          {rangeError && (
            <p className="sound-clip-editor__error" role="alert">
              {rangeError}
            </p>
          )}
          {!rangeError && state.range.endMs - state.range.startMs < 100 && (
            <p className="sound-clip-editor__hint">
              Очень короткий отрезок может быть трудно проверить на слух.
            </p>
          )}
          <div className="sound-clip-editor__actions">
            <button
              type="button"
              disabled={busy || Boolean(rangeError)}
              onClick={() => void generatePreview()}
            >
              {busy ? "Обрабатываем…" : "Создать предпросмотр"}
            </button>
            {candidate && (
              <>
                <label className="sound-clip-editor__loop">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={loop}
                    onChange={(event) => setLoop(event.target.checked)}
                  />{" "}
                  Повторять
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void togglePlayback()}
                >
                  {playing ? "Пауза" : "Прослушать"}
                </button>
                <audio
                  ref={attachAudioRef}
                  src={previewSource}
                  loop={loop}
                  preload="metadata"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  aria-label="Предпрослушивание эффекта"
                />
              </>
            )}
          </div>
          {candidate && (
            <p className="sound-clip-editor__hint">
              Предпросмотр действует до{" "}
              {new Date(candidate.expiresAt).toLocaleTimeString("ru-RU", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
          <div className="sound-clip-editor__details">
            <label>
              Название эффекта
              <input
                value={label}
                maxLength={60}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label>
              Значок
              <input
                value={icon}
                maxLength={8}
                onChange={(event) => setIcon(event.target.value)}
              />
            </label>
            <label>
              Категория
              <input
                value={category}
                maxLength={32}
                onChange={(event) => setCategory(event.target.value)}
              />
            </label>
            <label>
              Кому доступен
              <select
                value={audience}
                onChange={(event) =>
                  setAudience(event.target.value as typeof audience)
                }
              >
                <option value="ALL_MEMBERS">Всем участникам</option>
                <option value="GM_ONLY">Только ведущему</option>
              </select>
            </label>
            <label className="sound-clip-editor__note">
              Источник / лицензия
              <input
                value={sourceNoteValue}
                maxLength={240}
                onChange={(event) => setSourceNoteValue(event.target.value)}
              />
            </label>
          </div>
          {error && (
            <p className="sound-clip-editor__error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="sound-clip-editor__success" role="status">
              {notice}
            </p>
          )}
          <div className="sound-clip-editor__footer">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            {saved ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshSavedCatalog()}
              >
                Повторить обновление каталога
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  busy || !candidate || !label.trim() || Boolean(rangeError)
                }
                onClick={() => void saveCurrent()}
              >
                Сохранить эффект
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

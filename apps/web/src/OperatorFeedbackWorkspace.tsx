import { memo, useCallback, useEffect, useState } from "react";
import { Button } from "@gravity-ui/uikit";
import { ArkenDialog } from "./ui/ArkenDialog";
import {
  fetchAttachment,
  fetchFeedbackDetail,
  fetchFeedbackList,
  fetchRedactedExport,
  transitionPayload,
  transitions,
  updateFeedback,
  type FeedbackDetail,
  type FeedbackListItem,
  type FeedbackStatus,
} from "./operator-feedback";
import "./OperatorFeedbackWorkspace.css";

const safeError = "Operation failed. Try again.";

/**
 * UIX-395: memoized since this panel is self-fetching (fetches its own list
 * via `refreshList`/`fetchFeedbackDetail` on `open`, not driven by
 * `GameSnapshot`) — only `open`/`onClose` come from the parent, so a stable
 * `onClose` (see `closeWorkspace` in `Sidebar.tsx`) lets this panel skip
 * re-rendering on every unrelated realtime snapshot event.
 */
export const OperatorFeedbackWorkspace = memo(function OperatorFeedbackWorkspace({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<FeedbackListItem[]>([]);
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [linearKey, setLinearKey] = useState("");
  const [linearUrl, setLinearUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const closeImage = useCallback(() => {
    setImageUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, []);
  const clearSensitive = useCallback(() => {
    setDetail(null);
    closeImage();
  }, [closeImage]);
  const refreshList = useCallback(async () => {
    const response = await fetchFeedbackList();
    setItems(response.items);
  }, []);
  useEffect(() => () => closeImage(), [closeImage]);
  useEffect(() => {
    if (!open) {
      clearSensitive();
      return;
    }
    setError("");
    void refreshList().catch(() => {
      setError("Feedback access was lost");
      clearSensitive();
      onClose();
    });
  }, [open, onClose, refreshList, clearSensitive]);

  async function select(id: string) {
    clearSensitive();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      setDetail(await fetchFeedbackDetail(id));
    } catch {
      setError(safeError);
    } finally {
      setBusy(false);
    }
  }
  async function transition(status: FeedbackStatus) {
    if (!detail) return;
    const payload = transitionPayload(status, linearKey, linearUrl);
    if (!payload) {
      setError("Enter a valid Linear key and URL.");
      return;
    }
    const id = detail.id;
    setBusy(true);
    setError("");
    setNotice("");
    closeImage();
    try {
      await updateFeedback(id, payload);
      setDetail(await fetchFeedbackDetail(id));
      await refreshList();
      setLinearKey("");
      setLinearUrl("");
    } catch {
      setDetail(null);
      setError(safeError);
    } finally {
      setBusy(false);
    }
  }
  async function reveal() {
    if (!detail) return;
    setBusy(true);
    setError("");
    closeImage();
    try {
      setDetail(await fetchFeedbackDetail(detail.id, true));
    } catch {
      setDetail(null);
      setError(safeError);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!detail) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await fetchRedactedExport(detail.id);
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setNotice("Redacted copy copied.");
    } catch {
      setError("Copy failed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function openAttachment(attachmentId: string) {
    if (!detail) return;
    closeImage();
    setBusy(true);
    setError("");
    try {
      const blob = await fetchAttachment(detail.id, attachmentId);
      setImageUrl(URL.createObjectURL(blob));
    } catch {
      setError("Could not open the image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ArkenDialog
      open={open}
      title="Operator feedback"
      variant="workspace"
      footer={false}
      className="operator-feedback"
      onClose={() => {
        clearSensitive();
        onClose();
      }}
    >
      <div className="operator-feedback__grid">
        <nav aria-label="Operator feedback">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={busy}
              onClick={() => void select(item.id)}
            >
              <b>{item.kind}</b>
              <span>
                {item.status} / {new Date(item.createdAt).toLocaleString()}
              </span>
            </button>
          ))}
        </nav>
        <section>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {detail ? (
            <>
              <h3>{detail.title}</h3>
              <p>{detail.description}</p>
              <p>Status: {detail.status}</p>
              {transitions[detail.status].includes("LINKED") && (
                <div>
                  <label>
                    Linear key
                    <input
                      value={linearKey}
                      onChange={(event) => setLinearKey(event.target.value)}
                      placeholder="UIX-318"
                    />
                  </label>
                  <label>
                    Linear URL
                    <input
                      value={linearUrl}
                      onChange={(event) => setLinearUrl(event.target.value)}
                      placeholder="https://linear.app/.../issue/UIX-318/..."
                    />
                  </label>
                </div>
              )}
              <div>
                {transitions[detail.status].map((status) => {
                  const payload = transitionPayload(
                    status,
                    linearKey,
                    linearUrl,
                  );
                  return (
                    <Button
                      key={status}
                      disabled={busy || payload === null}
                      onClick={() => void transition(status)}
                    >
                      {status}
                    </Button>
                  );
                })}
              </div>
              <Button disabled={busy} onClick={() => void reveal()}>
                Reveal sensitive data
              </Button>
              <Button disabled={busy} onClick={() => void copy()}>
                Копировать обезличенную версию
              </Button>
              {detail.contact !== undefined && (
                <pre>
                  {detail.contact}
                  {"\n"}
                  {JSON.stringify(detail.diagnostics, null, 2)}
                </pre>
              )}
              {detail.attachments.map((attachment) => (
                <Button
                  disabled={busy}
                  key={attachment.id}
                  onClick={() => void openAttachment(attachment.id)}
                >
                  Open image
                </Button>
              ))}
              {imageUrl && <img src={imageUrl} alt="Feedback attachment" />}
            </>
          ) : (
            <p>
              {busy
                ? "Loading..."
                : "Select feedback. Detail is hidden by default."}
            </p>
          )}
        </section>
      </div>
    </ArkenDialog>
  );
});

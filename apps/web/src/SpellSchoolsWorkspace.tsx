import { useEffect, useRef, useState } from "react";
import type {
  SpellCost,
  SpellNode,
  SpellPackVersionDto,
  SpellProgressionGraph,
  SpellRequirementGroup,
  SpellSchool,
  TransitionSpellPackLifecycleCommand,
  SpellUsageLimit,
} from "@arken/contracts";
import { ApiError, formatApiError } from "./api";
import {
  appendSpellPackDraftVersion,
  createSpellPackDraft,
  fetchSpellPackList,
  fetchSpellPackVersion,
  promoteSpellPackToActive,
  validateSpellPackDraft,
  type SpellPackSummary,
} from "./spell-schools-client";
import {
  createEmptySpellDraft,
  createPrerequisiteEdge,
  createRequirementGroup,
  createSpellNode,
  createSpellSchool,
  nextSpellDraftVersion,
} from "./spell-schools-editor";
import "./SpellSchoolsWorkspace.css";
import { SpellNodeActivationEditor } from "./SpellNodeActivationEditor";
import { spellActivationDraftError } from "./spell-node-activation";

type PendingSave = {
  fingerprint: string;
  graph: SpellProgressionGraph;
  actionId: string;
  expectedVersion: number;
};

const id = () => globalThis.crypto.randomUUID();
const issueText = (issue: { path: string; message: string }) =>
  `${issue.path}: ${issue.message}`;

/**
 * GM-only spell graph draft editor. Root navigation owns where this component
 * is mounted; it intentionally has no App/Sidebar dependencies.
 */
export function SpellSchoolsWorkspace({
  onClose,
  onPendingChange,
}: {
  onClose?: () => void;
  /** True during requests or while a retry/conflict draft could be lost by closing navigation. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const [packs, setPacks] = useState<SpellPackSummary[]>([]);
  const [graph, setGraph] = useState<SpellProgressionGraph | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retryPending, setRetryPending] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const [conflictedDraft, setConflictedDraft] =
    useState<SpellProgressionGraph | null>(null);
  const [activationPrompt, setActivationPrompt] = useState<{
    packId: string;
    versionId: string;
    version: number;
    warnings: Array<{ code: string; path: string; message: string }>;
  } | null>(null);
  const [pendingActivation, setPendingActivation] =
    useState<TransitionSpellPackLifecycleCommand | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [packTitle, setPackTitle] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [newNodeNames, setNewNodeNames] = useState<Record<string, string>>({});
  const [edgeDraft, setEdgeDraft] = useState({
    sourceNodeId: "",
    groupId: "",
    newTargetNodeId: "",
    mode: "ALL" as SpellRequirementGroup["mode"],
  });
  const pendingSave = useRef<PendingSave | null>(null);
  const savedGraphFingerprint = useRef<string | null>(null);
  const [savedFingerprintSnapshot, setSavedFingerprintSnapshot] = useState<string | null>(null);
  const graphIsDirty = Boolean(
    graph && !isNew && savedFingerprintSnapshot !== JSON.stringify(graph),
  );
  const editorLocked =
    retryPending || versionConflict || pendingActivation !== null;
  const hasRecoveryCopy = conflictedDraft !== null;

  useEffect(() => {
    onPendingChange?.(
      busy ||
        retryPending ||
        versionConflict ||
        hasRecoveryCopy ||
        pendingActivation !== null,
    );
    return () => onPendingChange?.(false);
  }, [
    busy,
    hasRecoveryCopy,
    onPendingChange,
    pendingActivation,
    retryPending,
    versionConflict,
  ]);

  const loadPacks = async () => {
    setLoading(true);
    setError("");
    try {
      setPacks(await fetchSpellPackList());
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось загрузить черновики."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPacks();
  }, []);

  const updateGraph = (
    update: (current: SpellProgressionGraph) => SpellProgressionGraph,
  ) => {
    if (editorLocked || busy) return;
    setGraph((current) => (current ? update(current) : current));
    setActivationPrompt(null);
    pendingSave.current = null;
    setError("");
    setNotice("");
  };

  const selectPack = async (pack: SpellPackSummary) => {
    if (editorLocked || busy) return;
    setBusy(true);
    setError("");
    try {
      const version = await fetchSpellPackVersion(
        pack.id,
        pack.latestVersionId,
      );
      setGraph(version.graph);
      savedGraphFingerprint.current = JSON.stringify(version.graph);
      setSavedFingerprintSnapshot(JSON.stringify(version.graph));
      setIsNew(false);
      setActivationPrompt(null);
      setVersionConflict(false);
      setPackTitle(version.graph.title);
      setSchoolName("");
      pendingSave.current = null;
      setNotice("");
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось открыть версию."));
    } finally {
      setBusy(false);
    }
  };

  const startDraft = () => {
    if (editorLocked || busy) return;
    const title = packTitle.trim();
    const name = schoolName.trim();
    if (!title || !name) {
      setError("Укажите название набора и школы.");
      return;
    }
    const empty = createEmptySpellDraft(title);
    setGraph({ ...empty, schools: [createSpellSchool(empty, name)] });
    savedGraphFingerprint.current = null;
    setSavedFingerprintSnapshot(null);
    setIsNew(true);
    setActivationPrompt(null);
    setError("");
    setNotice("");
    pendingSave.current = null;
  };

  const addSchool = () => {
    const name = schoolName.trim();
    if (!name) return setError("Укажите название школы.");
    updateGraph((current) => ({
      ...current,
      schools: [...current.schools, createSpellSchool(current, name)],
    }));
    setSchoolName("");
  };

  const addNode = (schoolId: string) => {
    const name = (newNodeNames[schoolId] ?? "").trim();
    if (!name) return setError("Укажите название узла.");
    updateGraph((current) => ({
      ...current,
      nodes: [...current.nodes, createSpellNode(current, schoolId, name)],
    }));
    setNewNodeNames((current) => ({ ...current, [schoolId]: "" }));
  };

  const changeSchool = (schoolId: string, patch: Partial<SpellSchool>) =>
    updateGraph((current) => ({
      ...current,
      schools: current.schools.map((school) =>
        school.id === schoolId ? { ...school, ...patch } : school,
      ),
    }));

  const changeNode = (nodeId: string, patch: Partial<SpellNode>) =>
    updateGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...patch } : node,
      ),
    }));

  const addGroup = () => {
    if (!edgeDraft.newTargetNodeId) {
      setError("Выберите целевой узел для группы.");
      return;
    }
    try {
      const group = createRequirementGroup(
        graph!,
        edgeDraft.newTargetNodeId,
        edgeDraft.mode,
      );
      updateGraph((current) => ({
        ...current,
        requirementGroups: [...current.requirementGroups, group],
      }));
      setEdgeDraft((current) => ({ ...current, groupId: group.id }));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось добавить группу.",
      );
    }
  };

  const addEdge = () => {
    if (!edgeDraft.sourceNodeId || !edgeDraft.groupId) {
      setError("Выберите требуемый узел и группу условий.");
      return;
    }
    try {
      const edge = createPrerequisiteEdge(
        graph!,
        edgeDraft.sourceNodeId,
        edgeDraft.groupId,
      );
      updateGraph((current) => ({
        ...current,
        edges: [...current.edges, edge],
      }));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Не удалось добавить связь.",
      );
    }
  };

  const removeEdge = (edgeId: string) =>
    updateGraph((current) => ({
      ...current,
      edges: current.edges.filter((edge) => edge.id !== edgeId),
    }));

  const removeGroup = (groupId: string) => {
    updateGraph((current) => ({
      ...current,
      requirementGroups: current.requirementGroups.filter(
        (group) => group.id !== groupId,
      ),
      edges: current.edges.filter(
        (edge) => edge.requirementGroupId !== groupId,
      ),
    }));
    if (edgeDraft.groupId === groupId)
      setEdgeDraft((current) => ({ ...current, groupId: "" }));
  };

  const save = async () => {
    if (!graph || busy || (editorLocked && !retryPending) || hasRecoveryCopy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const activationError = graph.nodes.map((node) => spellActivationDraftError(node.activation)).find(Boolean);
      if (activationError) { setError(activationError); return; }
      const validation = await validateSpellPackDraft(graph);
      if (!validation.valid) {
        setError(validation.errors.map(issueText).join("\n"));
        return;
      }

      const fingerprint = JSON.stringify({ graph, isNew });
      let pending = pendingSave.current;
      if (!pending || pending.fingerprint !== fingerprint) {
        const submittedGraph = isNew ? graph : nextSpellDraftVersion(graph);
        pending = {
          fingerprint,
          graph: submittedGraph,
          actionId: id(),
          expectedVersion: isNew ? 0 : graph.version,
        };
        pendingSave.current = pending;
        setRetryPending(true);
      }

      const saved: SpellPackVersionDto = isNew
        ? await createSpellPackDraft(pending.graph, pending.actionId)
        : await appendSpellPackDraftVersion(
            pending.graph,
            pending.expectedVersion,
            pending.actionId,
          );
      setGraph(saved.graph);
      savedGraphFingerprint.current = JSON.stringify(saved.graph);
      setSavedFingerprintSnapshot(JSON.stringify(saved.graph));
      setIsNew(false);
      setRetryPending(false);
      setVersionConflict(false);
      setConflictedDraft(null);
      setActivationPrompt(null);
      setPackTitle(saved.graph.title);
      pendingSave.current = null;
      setNotice(
        `Сохранена версия ${saved.version}. История предыдущей версии не изменена.`,
      );
      await loadPacks();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        pendingSave.current = null;
        setRetryPending(false);
        setVersionConflict(true);
        setConflictedDraft(graph);
        setError(
          `Сервер отклонил сохранение (${reason.code}). Экранный черновик сохранён, но этот запрос нельзя повторять бесконечно. Скачайте его копию, затем загрузите актуальную версию и перенесите изменения вручную.`,
        );
      } else
        setError(
          formatApiError(
            reason,
            "Не удалось сохранить черновик. Повторите проверку; если команда сохранения уже отправлялась, повтор будет идентичным.",
          ),
        );
    } finally {
      setBusy(false);
    }
  };

  const requestActivation = async () => {
    if (
      !graph ||
      isNew ||
      !["DRAFT", "REFERENCE"].includes(graph.lifecycle) ||
      busy ||
      pendingActivation
    )
      return;
    if (graphIsDirty) {
      setError(
        "Сначала сохраните изменения новой версией, затем активируйте сохранённую версию.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const activationError = graph.nodes.map((node) => spellActivationDraftError(node.activation)).find(Boolean);
      if (activationError) { setError(activationError); return; }
      const validation = await validateSpellPackDraft(graph);
      if (!validation.valid) {
        setError(validation.errors.map(issueText).join("\n"));
        return;
      }
      setActivationPrompt({
        packId: graph.packId,
        versionId: graph.versionId,
        version: graph.version,
        warnings: validation.warnings,
      });
    } catch (reason) {
      setError(
        formatApiError(reason, "Не удалось проверить выбранную версию."),
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmActivation = async () => {
    if (!graph || !activationPrompt || busy) return;
    if (
      graphIsDirty ||
      activationPrompt.packId !== graph.packId ||
      activationPrompt.versionId !== graph.versionId ||
      activationPrompt.version !== graph.version
    ) {
      setActivationPrompt(null);
      setError(
        "Выбранная версия изменилась. Сначала сохраните изменения и повторно проверьте активацию.",
      );
      return;
    }
    const command =
      pendingActivation ?? {
        actionId: id(),
        expectedVersion: graph.version,
        versionId: id(),
        lifecycle: "ACTIVE" as const,
      };
    setPendingActivation(command);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const activated = await promoteSpellPackToActive(graph.packId, command);
      setGraph(activated.graph);
      savedGraphFingerprint.current = JSON.stringify(activated.graph);
      setSavedFingerprintSnapshot(JSON.stringify(activated.graph));
      setPackTitle(activated.graph.title);
      setPendingActivation(null);
      setActivationPrompt(null);
      setNotice(
        `Создана активная версия ${activated.version}. Её школы доступны мастеру для явной выдачи персонажам; это не назначает школы автоматически.`,
      );
      await loadPacks();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setPendingActivation(null);
        setError(
          `Версия изменилась на сервере (${reason.code}). Черновик сохранён; загрузите актуальную версию и повторите отдельное решение об активации.`,
        );
      } else {
        setError(
          formatApiError(
            reason,
            "Не удалось подтвердить активацию. Повтор будет отправлен с тем же идентификатором и ожидаемой версией.",
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadDraftCopy = () => {
    const draftToDownload = conflictedDraft ?? graph;
    if (!draftToDownload) return;
    const objectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(draftToDownload, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `spell-draft-${draftToDownload.packId}-v${draftToDownload.version}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  };

  const reloadAfterConflict = async () => {
    if (!graph) return;
    setBusy(true);
    setError("");
    try {
      const current = (await fetchSpellPackList()).find(
        (pack) => pack.id === graph.packId,
      );
      if (!current) {
        setError(
          "Набор не найден в доступном списке. Скачайте копию черновика перед закрытием.",
        );
        return;
      }
      const latest = await fetchSpellPackVersion(
        current.id,
        current.latestVersionId,
      );
      setGraph(latest.graph);
      savedGraphFingerprint.current = JSON.stringify(latest.graph);
      setSavedFingerprintSnapshot(JSON.stringify(latest.graph));
      setIsNew(false);
      setActivationPrompt(null);
      setPackTitle(latest.graph.title);
      setVersionConflict(false);
      pendingSave.current = null;
      setNotice(
        `Загружена серверная версия ${latest.version}. Перенесите изменения из скачанной копии и сохраните как новую версию.`,
      );
    } catch (reason) {
      setError(
        formatApiError(reason, "Не удалось загрузить актуальную версию."),
      );
    } finally {
      setBusy(false);
    }
  };

  const appendCost = (node: SpellNode) =>
    changeNode(node.id, {
      costs: [
        ...node.costs,
        {
          resource: "",
          amount: { kind: "FIXED", value: 1 },
          timing: "ON_ACTIVATE",
        },
      ],
    });

  const changeCost = (node: SpellNode, index: number, cost: SpellCost) =>
    changeNode(node.id, {
      costs: node.costs.map((current, costIndex) =>
        costIndex === index ? cost : current,
      ),
    });

  const changeUsage = (node: SpellNode, usageLimit: SpellUsageLimit | null) =>
    changeNode(node.id, { usageLimit });

  if (loading)
    return (
      <section className="spell-schools-workspace" aria-busy="true">
        Загрузка наборов…
      </section>
    );

  return (
    <section
      className="spell-schools-workspace"
      aria-labelledby="spell-schools-title"
    >
      <header className="spell-schools-header">
        <div>
          <p className="spell-schools-eyebrow">
            Только для мастера · черновики
          </p>
          <h1 id="spell-schools-title">Школы и ветки заклинаний</h1>
          <p>
            Редактирование создаёт новую неизменяемую версию. Публикация и
            выдача персонажу доступны только отдельными подтверждёнными
            действиями.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            className="spell-schools-close"
            disabled={busy || editorLocked || hasRecoveryCopy}
            onClick={onClose}
          >
            Закрыть
          </button>
        )}
      </header>

      {error && (
        <div className="spell-schools-message is-error" role="alert">
          {error}
        </div>
      )}
      {versionConflict && (
        <div
          className="spell-schools-conflict-actions"
          role="group"
          aria-label="Восстановление конфликта версии"
        >
          <button type="button" onClick={downloadDraftCopy}>
            Скачать копию экранного черновика
          </button>
          <button
            type="button"
            onClick={() => void reloadAfterConflict()}
            disabled={busy}
          >
            Загрузить актуальную версию (заменит экранный черновик)
          </button>
        </div>
      )}
      {notice && (
        <div className="spell-schools-message is-success" role="status">
          {notice}
        </div>
      )}
      {activationPrompt && graph && (
        <section
          className="spell-schools-conflict-actions"
          aria-label="Подтверждение активации версии"
        >
          <h2>Активировать выбранную версию?</h2>
          <p>
            Будет создана новая неизменяемая ACTIVE-версия набора. Её школы
            станут доступны мастерам для отдельной выдачи персонажам; существующие
            выдачи не изменятся и не создадутся автоматически.
          </p>
          {activationPrompt.warnings.length > 0 && (
            <div>
              <p>Предупреждения проверки текущей версии:</p>
              <ul>
                {activationPrompt.warnings.map((warning, index) => (
                  <li key={`${warning.code}:${warning.path}:${index}`}>
                    {issueText(warning)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {activationPrompt.warnings.some(
            (warning) => warning.code === "OPEN_IMPORT_WARNING",
          ) && (
            <p role="alert">
              Неразрешённые предупреждения импорта блокируют активацию. Сначала
              отметьте их разрешёнными в черновике.
            </p>
          )}
          <button
            type="button"
            disabled={
              busy ||
              activationPrompt.warnings.some(
                (warning) => warning.code === "OPEN_IMPORT_WARNING",
              )
            }
            onClick={() => void confirmActivation()}
          >
            {pendingActivation
              ? "Повторить ту же активацию"
              : "Подтвердить создание ACTIVE-версии"}
          </button>
          {!pendingActivation && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setActivationPrompt(null)}
            >
              Отмена
            </button>
          )}
        </section>
      )}
      {hasRecoveryCopy && !versionConflict && (
        <div
          className="spell-schools-conflict-actions"
          role="group"
          aria-label="Сохранённая копия конфликтного черновика"
        >
          <p>
            Копия прежнего экранного черновика хранится в памяти до сохранения
            перенесённых изменений или её явного удаления.
          </p>
          <button type="button" onClick={downloadDraftCopy}>
            Скачать копию конфликтного черновика
          </button>
          <button
            type="button"
            onClick={() => setConflictedDraft(null)}
          >
            Удалить сохранённую копию и разрешить закрытие
          </button>
        </div>
      )}

      <div className="spell-schools-layout">
        <aside className="spell-schools-list" aria-label="Наборы заклинаний">
          <h2>Наборы кампании</h2>
          {packs.length === 0 && <p>Сохранённых наборов пока нет.</p>}
          {packs.map((pack) => (
            <button
              className="spell-pack-choice"
              type="button"
              key={pack.id}
              aria-current={graph?.packId === pack.id ? "true" : undefined}
              disabled={busy || editorLocked || hasRecoveryCopy}
              onClick={() => void selectPack(pack)}
            >
              <strong>{pack.title}</strong>
              <span>
                Версия {pack.latestVersion} ·{" "}
                {pack.lifecycle === "DRAFT"
                  ? "черновик"
                  : pack.lifecycle.toLowerCase()}
              </span>
            </button>
          ))}
          <div className="spell-schools-new-pack">
            <h3>Новый черновик</h3>
            <label>
              Название набора
              <input
                value={packTitle}
                disabled={busy || editorLocked || hasRecoveryCopy}
                onChange={(event) => setPackTitle(event.target.value)}
              />
            </label>
            <label>
              Название первой школы
              <input
                value={schoolName}
                disabled={busy || editorLocked || hasRecoveryCopy}
                onChange={(event) => setSchoolName(event.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={startDraft}
              disabled={busy || editorLocked || hasRecoveryCopy}
            >
              Создать черновик школы
            </button>
          </div>
        </aside>

        <div className="spell-schools-editor">
          {!graph ? (
            <div className="spell-schools-empty">
              <h2>Выберите набор или начните новый</h2>
              <p>Независимые узлы допустимы; связь не обязательна.</p>
            </div>
          ) : (
            <>
              <fieldset
                className="spell-editor-fields"
                disabled={busy || editorLocked}
                aria-label="Поля черновика школы и веток"
              >
                <div className="spell-schools-title-row">
                  <label>
                    Название набора
                    <input
                      value={graph.title}
                      onChange={(event) =>
                        updateGraph((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <span className="spell-schools-version">
                    {isNew
                      ? "Новый черновик"
                      : `Редактируется версия ${graph.version}`}
                  </span>
                </div>
                <label className="spell-schools-notes">
                  Заметки набора
                  <textarea
                    value={graph.notes ?? ""}
                    onChange={(event) =>
                      updateGraph((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                  />
                </label>

                {graph.schools.map((school) => (
                  <fieldset className="spell-school-card" key={school.id}>
                    <legend>Школа</legend>
                    <div className="spell-school-fields">
                      <label>
                        Название
                        <input
                          value={school.displayName}
                          onChange={(event) =>
                            changeSchool(school.id, {
                              displayName: event.target.value,
                              sourceName: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Описание
                        <textarea
                          value={school.description}
                          onChange={(event) =>
                            changeSchool(school.id, {
                              description: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="spell-node-list">
                      {graph.nodes
                        .filter((node) => node.schoolId === school.id)
                        .map((node) => (
                          <fieldset className="spell-node-card" key={node.id}>
                            <legend>Узел ветки</legend>
                            <div className="spell-school-fields">
                              <label>
                                Название
                                <input
                                  value={node.displayName}
                                  onChange={(event) =>
                                    changeNode(node.id, {
                                      displayName: event.target.value,
                                      sourceName: event.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Описание
                                <textarea
                                  value={node.narrativeText}
                                  onChange={(event) =>
                                    changeNode(node.id, {
                                      narrativeText: event.target.value,
                                    })
                                  }
                                />
                              </label>
                            </div>
                            <label>
                              Текст механики
                              <textarea
                                value={node.mechanicsText}
                                onChange={(event) =>
                                  changeNode(node.id, {
                                    mechanicsText: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <SpellNodeActivationEditor
                              value={node.activation}
                              disabled={editorLocked || busy}
                              onChange={(activation) =>
                                changeNode(node.id, { activation })
                              }
                            />
                            <div className="spell-cost-list">
                              <h4>Стоимость</h4>
                              {node.costs.map((cost, index) => (
                                <fieldset
                                  className="spell-cost-card"
                                  key={`${node.id}-cost-${index}`}
                                >
                                  <legend>Затрата {index + 1}</legend>
                                  <label>
                                    Ресурс
                                    <input
                                      value={cost.resource}
                                      onChange={(event) =>
                                        changeCost(node, index, {
                                          ...cost,
                                          resource: event.target.value,
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Тип суммы
                                    <select
                                      value={cost.amount.kind}
                                      onChange={(event) =>
                                        changeCost(node, index, {
                                          ...cost,
                                          amount:
                                            event.target.value === "FORMULA"
                                              ? { kind: "FORMULA", formula: "" }
                                              : { kind: "FIXED", value: 1 },
                                        })
                                      }
                                    >
                                      <option value="FIXED">Число</option>
                                      <option value="FORMULA">Формула</option>
                                    </select>
                                  </label>
                                  {cost.amount.kind === "FIXED" ? (
                                    <label>
                                      Количество
                                      <input
                                        type="number"
                                        min="0.01"
                                        step="any"
                                        value={cost.amount.value}
                                        onChange={(event) =>
                                          changeCost(node, index, {
                                            ...cost,
                                            amount: {
                                              kind: "FIXED",
                                              value: Number(event.target.value),
                                            },
                                          })
                                        }
                                      />
                                    </label>
                                  ) : (
                                    <label>
                                      Формула
                                      <input
                                        value={cost.amount.formula}
                                        onChange={(event) =>
                                          changeCost(node, index, {
                                            ...cost,
                                            amount: {
                                              kind: "FORMULA",
                                              formula: event.target.value,
                                            },
                                          })
                                        }
                                      />
                                    </label>
                                  )}
                                  <label>
                                    Момент
                                    <select
                                      value={cost.timing}
                                      onChange={(event) =>
                                        changeCost(node, index, {
                                          ...cost,
                                          timing: event.target
                                            .value as SpellCost["timing"],
                                        })
                                      }
                                    >
                                      <option value="ON_ACTIVATE">
                                        При активации
                                      </option>
                                      <option value="ON_SUCCESS">
                                        При успехе
                                      </option>
                                      <option value="PER_TURN">За ход</option>
                                    </select>
                                  </label>
                                  <label>
                                    Исходная формулировка (необязательно)
                                    <input
                                      value={cost.rawText ?? ""}
                                      onChange={(event) =>
                                        changeCost(node, index, {
                                          ...cost,
                                          rawText:
                                            event.target.value || undefined,
                                        })
                                      }
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      changeNode(node.id, {
                                        costs: node.costs.filter(
                                          (_, itemIndex) => itemIndex !== index,
                                        ),
                                      })
                                    }
                                  >
                                    Удалить затрату
                                  </button>
                                </fieldset>
                              ))}
                              <button
                                type="button"
                                onClick={() => appendCost(node)}
                              >
                                Добавить затрату
                              </button>
                            </div>
                            <div className="spell-frequency">
                              <h4>Частота</h4>
                              {node.usageLimit ? (
                                <>
                                  <label>
                                    Использований
                                    <input
                                      type="number"
                                      min="1"
                                      step="1"
                                      value={node.usageLimit.maxUses}
                                      onChange={(event) =>
                                        changeUsage(node, {
                                          ...node.usageLimit!,
                                          maxUses: Number(event.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Период
                                    <select
                                      value={node.usageLimit.cadence.kind}
                                      onChange={(event) => {
                                        const kind = event.target
                                          .value as SpellUsageLimit["cadence"]["kind"];
                                        changeUsage(
                                          node,
                                          kind === "CUSTOM"
                                            ? {
                                                ...node.usageLimit!,
                                                cadence: {
                                                  kind: "CUSTOM",
                                                  rawText: "",
                                                },
                                              }
                                            : {
                                                ...node.usageLimit!,
                                                cadence: { kind },
                                              },
                                        );
                                      }}
                                    >
                                      <option value="TURN">Ход</option>
                                      <option value="COMBAT">Бой</option>
                                      <option value="SHORT_REST">
                                        Короткий отдых
                                      </option>
                                      <option value="LONG_REST">
                                        Долгий отдых
                                      </option>
                                      <option value="DAY">День</option>
                                      <option value="WEEK">Неделя</option>
                                      <option value="SESSION">Сессия</option>
                                      <option value="CAMPAIGN">Кампания</option>
                                      <option value="MONTH">Месяц</option>
                                      <option value="CUSTOM">Другое</option>
                                    </select>
                                  </label>
                                  {node.usageLimit.cadence.kind ===
                                    "CUSTOM" && (
                                    <label>
                                      Период
                                      <textarea
                                        value={node.usageLimit.cadence.rawText}
                                        onChange={(event) =>
                                          changeUsage(node, {
                                            ...node.usageLimit!,
                                            cadence: {
                                              kind: "CUSTOM",
                                              rawText: event.target.value,
                                            },
                                          })
                                        }
                                      />
                                    </label>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => changeUsage(node, null)}
                                  >
                                    Убрать ограничение частоты
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    changeUsage(node, {
                                      maxUses: 1,
                                      cadence: { kind: "DAY" },
                                    })
                                  }
                                >
                                  Задать частоту
                                </button>
                              )}
                            </div>
                          </fieldset>
                        ))}
                      {graph.nodes.every(
                        (node) => node.schoolId !== school.id,
                      ) && (
                        <p>
                          В школе пока нет узлов. Их можно добавлять независимо,
                          без обязательных связей.
                        </p>
                      )}
                    </div>
                    <div className="spell-add-row">
                      <label>
                        Новый узел
                        <input
                          value={newNodeNames[school.id] ?? ""}
                          onChange={(event) =>
                            setNewNodeNames((current) => ({
                              ...current,
                              [school.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <button type="button" onClick={() => addNode(school.id)}>
                        Добавить узел
                      </button>
                    </div>
                  </fieldset>
                ))}

                <div className="spell-add-row spell-add-school">
                  <label>
                    Новая школа
                    <input
                      value={schoolName}
                      onChange={(event) => setSchoolName(event.target.value)}
                    />
                  </label>
                  <button type="button" onClick={addSchool}>
                    Добавить школу
                  </button>
                </div>

                {graph.nodes.length > 0 && (
                  <section
                    className="spell-edge-editor"
                    aria-labelledby="spell-edges-title"
                  >
                    <h3 id="spell-edges-title">Предварительные связи</h3>
                    <p>
                      Сначала создайте группу для целевого узла, затем добавьте
                      в неё требуемые узлы. Несколько групп для цели сочетаются
                      по правилам графа; режимы групп сохраняются без
                      автозаполнения.
                    </p>
                    <div className="spell-add-row">
                      <label>
                        Целевой узел группы
                        <select
                          value={edgeDraft.newTargetNodeId}
                          onChange={(event) =>
                            setEdgeDraft((current) => ({
                              ...current,
                              newTargetNodeId: event.target.value,
                            }))
                          }
                        >
                          <option value="">Выберите</option>
                          {graph.nodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Режим новой группы
                        <select
                          value={edgeDraft.mode}
                          onChange={(event) =>
                            setEdgeDraft((current) => ({
                              ...current,
                              mode: event.target
                                .value as SpellRequirementGroup["mode"],
                            }))
                          }
                        >
                          <option value="ALL">ALL — все условия</option>
                          <option value="ANY">ANY — любое условие</option>
                          <option value="UNRESOLVED">
                            UNRESOLVED — требует разбора
                          </option>
                        </select>
                      </label>
                      <button type="button" onClick={addGroup}>
                        Добавить группу
                      </button>
                    </div>
                    <div className="spell-add-row">
                      <label>
                        Требуемый узел
                        <select
                          value={edgeDraft.sourceNodeId}
                          onChange={(event) =>
                            setEdgeDraft((current) => ({
                              ...current,
                              sourceNodeId: event.target.value,
                            }))
                          }
                        >
                          <option value="">Выберите</option>
                          {graph.nodes.map((node) => (
                            <option key={node.id} value={node.id}>
                              {node.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Группа назначения
                        <select
                          value={edgeDraft.groupId}
                          onChange={(event) =>
                            setEdgeDraft((current) => ({
                              ...current,
                              groupId: event.target.value,
                            }))
                          }
                        >
                          <option value="">Выберите</option>
                          {graph.requirementGroups.map((group) => (
                            <option key={group.id} value={group.id}>
                              {graph.nodes.find(
                                (node) => node.id === group.targetNodeId,
                              )?.displayName ?? "Неизвестная цель"}{" "}
                              · {group.mode}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="button" onClick={addEdge}>
                        Добавить связь
                      </button>
                    </div>
                    {graph.requirementGroups.length === 0 ? (
                      <p>Групп и связей пока нет.</p>
                    ) : (
                      <div className="spell-edge-list">
                        {graph.requirementGroups.map((group) => (
                          <section className="spell-edge-group" key={group.id}>
                            <header>
                              <strong>
                                {graph.nodes.find(
                                  (node) => node.id === group.targetNodeId,
                                )?.displayName ?? "Неизвестная цель"}{" "}
                                · {group.mode}
                              </strong>
                              <button
                                type="button"
                                onClick={() => removeGroup(group.id)}
                              >
                                Удалить группу и её связи
                              </button>
                            </header>
                            {graph.edges.filter(
                              (edge) => edge.requirementGroupId === group.id,
                            ).length === 0 ? (
                              <p>
                                В группе пока нет требуемых узлов; добавьте хотя
                                бы одну связь.
                              </p>
                            ) : (
                              <ul>
                                {graph.edges
                                  .filter(
                                    (edge) =>
                                      edge.requirementGroupId === group.id,
                                  )
                                  .map((edge) => (
                                    <li key={edge.id}>
                                      <span>
                                        {graph.nodes.find(
                                          (node) =>
                                            node.id === edge.sourceNodeId,
                                        )?.displayName ??
                                          "Неизвестный узел"}{" "}
                                        →{" "}
                                        {graph.nodes.find(
                                          (node) =>
                                            node.id === edge.targetNodeId,
                                        )?.displayName ?? "Неизвестная цель"}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => removeEdge(edge.id)}
                                      >
                                        Удалить связь
                                      </button>
                                    </li>
                                  ))}
                              </ul>
                            )}
                          </section>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </fieldset>
              <div className="spell-editor-actions">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={
                    busy ||
                    (editorLocked && !retryPending) ||
                    hasRecoveryCopy ||
                    versionConflict ||
                    (!isNew && graph.lifecycle !== "DRAFT")
                  }
                >
                  {busy
                    ? "Проверка…"
                    : retryPending
                      ? "Повторить тот же запрос"
                      : isNew
                        ? "Проверить и сохранить черновик"
                        : "Проверить и сохранить новую версию"}
                </button>
                {!isNew && graph.lifecycle !== "DRAFT" && (
                  <span>Можно редактировать только черновую версию.</span>
                )}
                {!isNew &&
                  ["DRAFT", "REFERENCE"].includes(graph.lifecycle) && (
                    <button
                      type="button"
                      onClick={() => void requestActivation()}
                      disabled={busy || editorLocked || hasRecoveryCopy || graphIsDirty}
                    >
                      Подготовить явную активацию
                    </button>
                  )}
              </div>
              {graphIsDirty && !isNew && graph.lifecycle === "DRAFT" && (
                <p role="status">
                  Сначала сохраните изменения новой версией, затем активируйте её.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

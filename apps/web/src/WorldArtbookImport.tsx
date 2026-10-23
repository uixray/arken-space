import { useMemo, useState } from "react";
import type { AssetDto, WorldContentDto } from "@arken/contracts";
import { api, formatApiError } from "./api";
import { Button } from "./design-system/Button";
import {
  addWorldContentMedia,
  createWorldContentWithActionId,
  fetchWorldContentDetail,
  fetchWorldContentList,
  fetchWorldContentMedia,
  updateWorldContent,
} from "./world-content-client";
import {
  artbookActionId,
  inspectArtbookImage,
  artbookRelativePath,
  loadArtbook,
  planArtbookTextImport,
  proposeArtbookMedia,
  type ArtbookMediaProposal,
  type ArtbookSource,
  type ArtbookTextPlanItem,
} from "./world-artbook";

async function uploadImage(file: File, actionId: string, verifiedMime: string) {
  const form = new FormData();
  const uploadFile = file.type
    ? file
    : new File([file], file.name, { type: verifiedMime });
  form.append("file", uploadFile);
  return api<AssetDto>("/api/assets?kind=IMAGE", {
    method: "POST",
    headers: { "x-action-id": actionId },
    body: form,
  });
}

async function resolveUpload(actionId: string): Promise<AssetDto | null> {
  try {
    return await api<AssetDto>(
      `/api/assets/upload-actions/${encodeURIComponent(actionId)}`,
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 404
    )
      return null;
    throw error;
  }
}

type Outcome = {
  slug: string;
  path?: string;
  role?: "cover" | "gallery";
  hash?: string;
  phase: string;
  status: "created" | "matched" | "skipped" | "conflict" | "blocked" | "error";
  assetId?: string;
  nextAction?: string;
};

const textInput = (plan: ArtbookTextPlanItem) => ({
  slug: plan.record.slug,
  type: plan.record.type,
  name: plan.record.name,
  summary: plan.record.summary,
  provenance: {
    sourceUrl: plan.record.sourceUrl,
    sourceExternalId: plan.sourceId,
    retrievedAt: plan.retrievedAt,
    rawContentHash: plan.record.rawContentHash,
    attribution: plan.attribution,
    rightsReviewStatus: "APPROVED" as const,
    editorialApprovalStatus: "PENDING" as const,
  },
});

const matchesTextPlan = (
  entity: WorldContentDto,
  plan: ArtbookTextPlanItem,
) => {
  const expected = textInput(plan);
  const actual = entity.provenance;
  return (
    entity.lifecycle === "DRAFT" &&
    entity.slug === plan.record.slug &&
    entity.type === expected.type &&
    entity.name === expected.name &&
    entity.summary === expected.summary &&
    actual?.sourceUrl === expected.provenance.sourceUrl &&
    actual?.sourceExternalId === expected.provenance.sourceExternalId &&
    actual?.retrievedAt === expected.provenance.retrievedAt &&
    actual?.rawContentHash === expected.provenance.rawContentHash &&
    actual?.attribution === expected.provenance.attribution &&
    actual?.rightsReviewStatus === "APPROVED" &&
    actual?.editorialApprovalStatus === "PENDING"
  );
};

function resolveCreatedCanonical(
  entities: readonly WorldContentDto[],
  plan: ArtbookTextPlanItem,
) {
  const candidates = entities.filter(
    (entity) =>
      entity.slug === plan.record.slug ||
      (entity.provenance?.sourceUrl === plan.record.sourceUrl &&
        entity.provenance?.sourceExternalId === plan.sourceId),
  );
  if (candidates.length !== 1) return null;
  const [candidate] = candidates;
  return candidate && matchesTextPlan(candidate, plan) ? candidate : null;
}

const mediaIdentity = (proposal: ArtbookMediaProposal) =>
  `${proposal.slug}\n${proposal.role}\n${proposal.path}`;

/** GM review-first artbook import. Import remains DRAFT-only and never overwrites canon. */
export function WorldArtbookImport({
  campaignId,
  onChanged,
}: {
  campaignId?: string;
  onChanged: () => void;
}) {
  const [source, setSource] = useState<ArtbookSource | null>(null);
  const [textPlan, setTextPlan] = useState<ArtbookTextPlanItem[]>([]);
  const [mediaFiles, setMediaFiles] = useState<Map<string, File>>(new Map());
  const [pickedPaths, setPickedPaths] = useState<string[]>([]);
  const [ambiguousPaths, setAmbiguousPaths] = useState<Set<string>>(new Set());
  const [mediaHashes, setMediaHashes] = useState<Map<string, string>>(
    new Map(),
  );
  const [mediaMimeTypes, setMediaMimeTypes] = useState<Map<string, string>>(
    new Map(),
  );
  const [mediaInspectionErrors, setMediaInspectionErrors] = useState<
    Map<string, string>
  >(new Map());
  const [mediaReviewed, setMediaReviewed] = useState(false);
  const [textReviewed, setTextReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  const proposals = useMemo(
    () => (source ? proposeArtbookMedia(source) : []),
    [source],
  );
  const mediaReady = proposals.filter((item) => mediaFiles.has(item.path));
  const proposalPathCounts = new Map<string, number>();
  for (const item of proposals)
    proposalPathCounts.set(
      item.path,
      (proposalPathCounts.get(item.path) ?? 0) + 1,
    );
  const ambiguousProposalPaths = new Set(
    [...proposalPathCounts]
      .filter(([, count]) => count > 1)
      .map(([path]) => path),
  );
  const unmatchedPaths = [...new Set(pickedPaths)].filter(
    (path) => !proposals.some((proposal) => proposal.path === path),
  );
  const duplicatePaths = useMemo(() => {
    const counts = new Map<string, number>();
    for (const path of mediaFiles.keys())
      counts.set(path, (counts.get(path) ?? 0) + 1);
    return new Set(
      [...counts].filter(([, count]) => count > 1).map(([path]) => path),
    );
  }, [mediaFiles]);
  const textCounts = useMemo(
    () => ({
      create: textPlan.filter((item) => item.status === "create").length,
      matched: textPlan.filter((item) => item.status === "matched").length,
      conflict: textPlan.filter((item) => item.status === "conflict").length,
      blocked: textPlan.filter((item) => item.status === "blocked").length,
    }),
    [textPlan],
  );

  async function previewText() {
    setBusy(true);
    setError("");
    setTextReviewed(false);
    try {
      const loaded = await loadArtbook();
      const current = await fetchWorldContentList();
      setSource(loaded);
      setTextPlan(planArtbookTextImport(loaded, current));
      setOutcomes([]);
    } catch (reason) {
      setError(
        formatApiError(
          reason,
          "Не удалось подготовить предварительный просмотр.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmTextImport() {
    if (!source || !campaignId || !textReviewed) return;
    setBusy(true);
    setError("");
    const report: Outcome[] = [];
    try {
      // Re-read before any write; changed records invalidate the stale review.
      const current = await fetchWorldContentList();
      const freshPlan = planArtbookTextImport(source, current);
      const reviewedState = new Map(
        textPlan.map((item) => [item.record.slug, item.status]),
      );
      if (
        freshPlan.some(
          (item) => reviewedState.get(item.record.slug) !== item.status,
        )
      ) {
        setError(
          "Канон изменился после preview. Ничего не записано; обновите и проверьте preview ещё раз.",
        );
        setTextPlan(freshPlan);
        return;
      }
      setTextPlan(freshPlan);
      for (const item of freshPlan) {
        if (item.status === "matched") {
          report.push({
            slug: item.record.slug,
            phase: "review",
            status: "matched",
          });
          continue;
        }
        if (item.status !== "create") {
          report.push({
            slug: item.record.slug,
            phase: "review",
            status: item.status,
            nextAction: item.reason ?? "Ручная сверка.",
          });
          continue;
        }
        const actionId = await artbookActionId({
          campaignId,
          sourceUrl: item.record.sourceUrl,
          sourceId: item.sourceId,
          relativePath: `text/${item.record.slug}`,
          binarySha256: item.record.rawContentHash,
          operation: "text",
        });
        try {
          const created = await createWorldContentWithActionId(
            textInput(item),
            actionId,
          );
          if ("duplicate" in created) {
            const after = await fetchWorldContentList();
            const authoritative = resolveCreatedCanonical(after, item);
            report.push(
              authoritative && matchesTextPlan(authoritative, item)
                ? {
                    slug: item.record.slug,
                    phase: "create/reconcile",
                    status: "matched",
                  }
                : {
                    slug: item.record.slug,
                    phase: "create/reconcile",
                    status: "conflict",
                    nextAction:
                      "Повтор действия найден, но канон не совпадает; проверить вручную.",
                  },
            );
            continue;
          }
          report.push(
            matchesTextPlan(created, item)
              ? { slug: item.record.slug, phase: "create", status: "created" }
              : {
                  slug: item.record.slug,
                  phase: "create/verify",
                  status: "conflict",
                  nextAction:
                    "Ответ создания не совпал с ожидаемым DRAFT; сверить канон.",
                },
          );
        } catch (reason) {
          // A lost response is reconciled from persisted source + text, never by retrying a new identity.
          try {
            const after = await fetchWorldContentList();
            const authoritative = resolveCreatedCanonical(after, item);
            report.push(
              authoritative && matchesTextPlan(authoritative, item)
                ? {
                    slug: item.record.slug,
                    phase: "create/reconcile",
                    status: "matched",
                  }
                : {
                    slug: item.record.slug,
                    phase: "create",
                    status: "error",
                    nextAction: formatApiError(
                      reason,
                      "Повторить тот же просмотр после проверки канона.",
                    ),
                  },
            );
          } catch {
            report.push({
              slug: item.record.slug,
              phase: "create/unknown",
              status: "error",
              nextAction:
                "Состояние неизвестно. Повторить просмотр; action identity останется стабильным.",
            });
          }
        }
      }
      setOutcomes(report);
      onChanged();
    } catch (reason) {
      setError(
        formatApiError(reason, "Не удалось выполнить подтверждённый импорт."),
      );
    } finally {
      setBusy(false);
      setTextReviewed(false);
    }
  }

  async function selectMediaFolder(files: FileList | null) {
    const selectedFiles = files ? Array.from(files) : [];
    setMediaReviewed(false);
    setMediaFiles(new Map());
    setPickedPaths([]);
    setAmbiguousPaths(new Set());
    setMediaHashes(new Map());
    setMediaMimeTypes(new Map());
    setMediaInspectionErrors(new Map());
    if (selectedFiles.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const loaded = source ?? (await loadArtbook());
      setSource(loaded);
      const byPath = new Map<string, File>();
      const ambiguous = new Set<string>();
      const paths = selectedFiles.map(artbookRelativePath);
      setPickedPaths(paths);
      for (const file of selectedFiles) {
        const path = artbookRelativePath(file);
        if (byPath.has(path)) ambiguous.add(path);
        else byPath.set(path, file);
      }
      for (const path of ambiguous) byPath.delete(path);
      setAmbiguousPaths(ambiguous);
      const hashes = new Map<string, string>();
      const mimeTypes = new Map<string, string>();
      const inspectionErrors = new Map<string, string>();
      for (const [path, file] of byPath) {
        const inspected = await inspectArtbookImage(file);
        if (inspected.status === "valid") {
          hashes.set(path, inspected.sha256);
          mimeTypes.set(path, inspected.mimeType);
        } else inspectionErrors.set(path, inspected.reason);
      }
      setMediaFiles(byPath);
      setMediaHashes(hashes);
      setMediaMimeTypes(mimeTypes);
      setMediaInspectionErrors(inspectionErrors);
    } catch (reason) {
      setError(formatApiError(reason, "Не удалось проверить выбранные файлы."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMediaImport() {
    if (!source || !campaignId || !mediaReviewed) return;
    setBusy(true);
    setError("");
    const report: Outcome[] = [];
    try {
      const current = await fetchWorldContentList();
      const textRows = planArtbookTextImport(source, current);
      const bySlug = new Map<string, WorldContentDto[]>();
      for (const entity of current) {
        const group = bySlug.get(entity.slug) ?? [];
        group.push(entity);
        bySlug.set(entity.slug, group);
      }
      const planBySlug = new Map(
        textRows.map((item) => [item.record.slug, item]),
      );
      const proposalsBySlug = new Map<string, ArtbookMediaProposal[]>();
      for (const proposal of proposals) {
        const group = proposalsBySlug.get(proposal.slug) ?? [];
        group.push(proposal);
        proposalsBySlug.set(proposal.slug, group);
      }
      const preResolved = new Map<
        string,
        { actionId: string; asset: AssetDto | null; hash: string; file: File }
      >();
      const blockedBySlug = new Map<string, string>();
      for (const [slug, recordProposals] of proposalsBySlug) {
        const rowsForSlug = bySlug.get(slug) ?? [];
        const text = planBySlug.get(slug);
        if (
          rowsForSlug.length !== 1 ||
          !text ||
          text.status !== "matched" ||
          !matchesTextPlan(rowsForSlug[0]!, text)
        ) {
          blockedBySlug.set(
            slug,
            "Source identity/slug is ambiguous or does not match one reviewed DRAFT; no media writes were made.",
          );
          continue;
        }
        if (
          recordProposals.some((proposal) => {
            const file = mediaFiles.get(proposal.path);
            return (
              !file ||
              !mediaHashes.has(proposal.path) ||
              ambiguousPaths.has(proposal.path) ||
              duplicatePaths.has(proposal.path) ||
              ambiguousProposalPaths.has(proposal.path)
            );
          })
        ) {
          const invalidFile = recordProposals.find((proposal) =>
            mediaInspectionErrors.has(proposal.path),
          );
          blockedBySlug.set(
            slug,
            invalidFile
              ? `${invalidFile.path}: ${mediaInspectionErrors.get(invalidFile.path)} Полный набор записи заблокирован; загрузок не было.`
              : "Выберите полный однозначный набор файлов этой записи; без него нельзя безопасно отличить ранее импортированную галерею от ручной.",
          );
          continue;
        }
        try {
          for (const proposal of recordProposals) {
            const file = mediaFiles.get(proposal.path)!;
            const hash = mediaHashes.get(proposal.path)!;
            const actionId = await artbookActionId({
              campaignId,
              sourceUrl: text.record.sourceUrl,
              sourceId: text.sourceId,
              relativePath: proposal.path,
              binarySha256: hash,
              operation: "upload",
            });
            const asset = await resolveUpload(actionId);
            if (asset && asset.kind !== "IMAGE")
              throw new Error("Resolved upload is not an IMAGE asset.");
            preResolved.set(mediaIdentity(proposal), {
              actionId,
              asset,
              hash,
              file,
            });
          }
          const entity = rowsForSlug[0]!;
          const [latest, existingMedia] = await Promise.all([
            fetchWorldContentDetail(entity.id),
            fetchWorldContentMedia(entity.id),
          ]);
          if (!matchesTextPlan(latest, text)) throw new Error("SOURCE_CHANGED");
          const expectedIds = new Set(
            recordProposals
              .map(
                (proposal) =>
                  preResolved.get(mediaIdentity(proposal))?.asset?.id,
              )
              .filter((id): id is string => Boolean(id)),
          );
          const expectedCover = recordProposals.find(
            (item) => item.role === "cover",
          );
          const resolvedCoverId = expectedCover
            ? preResolved.get(mediaIdentity(expectedCover))?.asset?.id
            : undefined;
          if (latest.coverAssetId && latest.coverAssetId !== resolvedCoverId)
            throw new Error(
              "Существующая обложка не соответствует доказанному action identity; конфликт, загрузки не выполнялись.",
            );
          if (existingMedia.some((item) => !expectedIds.has(item.assetId)))
            throw new Error(
              "Галерея содержит asset вне полного доказанного набора; конфликт, загрузки не выполнялись.",
            );
        } catch (error) {
          blockedBySlug.set(
            slug,
            formatApiError(
              error,
              "Media preflight failed; no uploads were attempted.",
            ),
          );
        }
      }
      for (const proposal of proposals) {
        const file = mediaFiles.get(proposal.path);
        const hash = mediaHashes.get(proposal.path);
        const blocked = blockedBySlug.get(proposal.slug);
        if (blocked) {
          report.push({
            slug: proposal.slug,
            path: proposal.path,
            role: proposal.role,
            hash,
            phase: "read-only-preflight",
            status: "conflict",
            nextAction: blocked,
          });
          continue;
        }
        if (!file) {
          const ambiguous =
            duplicatePaths.has(proposal.path) ||
            ambiguousPaths.has(proposal.path) ||
            ambiguousProposalPaths.has(proposal.path);
          report.push({
            slug: proposal.slug,
            path: proposal.path,
            role: proposal.role,
            phase: "mapping",
            status: ambiguous ? "blocked" : "skipped",
            nextAction: ambiguous
              ? "Неоднозначный путь или несколько записей используют этот путь; требуется ручная сверка."
              : "Файл не выбран; добавить его в папку и повторить.",
          });
          continue;
        }
        if (ambiguousProposalPaths.has(proposal.path)) {
          report.push({
            slug: proposal.slug,
            path: proposal.path,
            role: proposal.role,
            hash,
            phase: "mapping",
            status: "blocked",
            nextAction:
              "Один путь сопоставлен нескольким записям; требуется ручная сверка.",
          });
          continue;
        }
        if (!hash) {
          report.push({
            slug: proposal.slug,
            path: proposal.path,
            role: proposal.role,
            phase: "mapping",
            status: "blocked",
            nextAction:
              mediaInspectionErrors.get(proposal.path) ??
              "Содержимое файла не прошло проверку изображения.",
          });
          continue;
        }
        const matchingRows = bySlug.get(proposal.slug) ?? [];
        const entity = matchingRows.length === 1 ? matchingRows[0] : undefined;
        const text = planBySlug.get(proposal.slug);
        if (
          !entity ||
          !text ||
          text.status !== "matched" ||
          !matchesTextPlan(entity, text)
        ) {
          report.push({
            slug: proposal.slug,
            path: proposal.path,
            role: proposal.role,
            hash,
            phase: "ownership-check",
            status: "conflict",
            nextAction:
              "Канон не совпадает с подтверждённым DRAFT-источником; медиа не изменено.",
          });
          continue;
        }
        const resolved = preResolved.get(mediaIdentity(proposal));
        if (!resolved) {
          report.push({
            slug: proposal.slug,
            path: proposal.path,
            role: proposal.role,
            hash,
            phase: "read-only-preflight",
            status: "blocked",
            nextAction:
              "The complete reviewed set was not resolved; no upload was attempted.",
          });
          continue;
        }
        const uploadId = resolved.actionId;
        const verifiedMime = mediaMimeTypes.get(proposal.path);
        if (!verifiedMime) {
          report.push({
            slug: proposal.slug,
            path: proposal.path,
            role: proposal.role,
            hash,
            phase: "mapping",
            status: "blocked",
            nextAction:
              "Проверенный MIME-тип отсутствует; загрузка не выполнялась.",
          });
          continue;
        }
        let assetId: string | undefined;
        try {
          if (resolved.asset) assetId = resolved.asset.id;
          else {
            try {
              assetId = (await uploadImage(file, uploadId, verifiedMime)).id;
            } catch {
              // Replay the exact operation once to recover a lost response; the
              // same campaign/action ID is guaranteed by the server upload path.
              assetId = (await uploadImage(file, uploadId, verifiedMime)).id;
            }
          }
          const latest = await fetchWorldContentDetail(entity.id);
          if (!matchesTextPlan(latest, text)) throw new Error("SOURCE_CHANGED");
          if (proposal.role === "cover") {
            if (latest.coverAssetId === assetId) {
              report.push({
                slug: proposal.slug,
                path: proposal.path,
                role: proposal.role,
                hash,
                phase: "reconcile",
                status: "matched",
                assetId,
              });
              continue;
            }
            if (latest.coverAssetId !== null) {
              report.push({
                slug: proposal.slug,
                path: proposal.path,
                role: proposal.role,
                hash,
                phase: "cover-conflict",
                status: "conflict",
                assetId,
                nextAction: "Существующая обложка отличается и не заменена.",
              });
              continue;
            }
            const patchId = await artbookActionId({
              campaignId,
              sourceUrl: text.record.sourceUrl,
              sourceId: text.sourceId,
              relativePath: proposal.path,
              binarySha256: hash,
              operation: "cover",
              entityId: entity.id,
              assetId,
            });
            try {
              await updateWorldContent(
                entity.id,
                { revision: latest.revision, coverAssetId: assetId },
                patchId,
              );
            } catch {
              /* reconcile below */
            }
            const reconciled = await fetchWorldContentDetail(entity.id);
            report.push(
              reconciled.coverAssetId === assetId
                ? {
                    slug: proposal.slug,
                    path: proposal.path,
                    role: proposal.role,
                    hash,
                    phase: "cover-attach",
                    status: "created",
                    assetId,
                  }
                : {
                    slug: proposal.slug,
                    path: proposal.path,
                    role: proposal.role,
                    hash,
                    phase: "cover-attach",
                    status: "error",
                    assetId,
                    nextAction:
                      "Asset сохранён, но обложка не привязана. Повторить с теми же файлами/action identity либо сверить вручную.",
                  },
            );
            continue;
          }
          const existingMedia = await fetchWorldContentMedia(entity.id);
          if (existingMedia.some((item) => item.assetId === assetId)) {
            report.push({
              slug: proposal.slug,
              path: proposal.path,
              role: proposal.role,
              hash,
              phase: "reconcile",
              status: "matched",
              assetId,
            });
            continue;
          }
          const mediaId = await artbookActionId({
            campaignId,
            sourceUrl: text.record.sourceUrl,
            sourceId: text.sourceId,
            relativePath: proposal.path,
            binarySha256: hash,
            operation: "gallery",
            entityId: entity.id,
            assetId,
          });
          try {
            await addWorldContentMedia(
              entity.id,
              {
                assetId,
                importPrecondition: {
                  expectedRevision: latest.revision,
                  slug: text.record.slug,
                  type: text.record.type,
                  name: text.record.name,
                  summary: text.record.summary,
                  provenance: latest.provenance!,
                },
              },
              mediaId,
            );
          } catch {
            /* reconcile below */
          }
          const reconciled = await fetchWorldContentMedia(entity.id);
          report.push(
            reconciled.some((item) => item.assetId === assetId)
              ? {
                  slug: proposal.slug,
                  path: proposal.path,
                  role: proposal.role,
                  hash,
                  phase: "gallery-attach",
                  status: "created",
                  assetId,
                }
              : {
                  slug: proposal.slug,
                  path: proposal.path,
                  role: proposal.role,
                  hash,
                  phase: "gallery-attach",
                  status: "error",
                  assetId,
                  nextAction:
                    "Asset сохранён, но галерея не подтверждена. Повторить с теми же файлами/action identity.",
                },
          );
        } catch (reason) {
          report.push({
            slug: proposal.slug,
            path: proposal.path,
            role: proposal.role,
            hash,
            phase: assetId ? "attach" : "upload",
            status: "error",
            assetId,
            nextAction: assetId
              ? "Проверить assetId и повторить reconcile; файл не удалён автоматически."
              : formatApiError(
                  reason,
                  "Повторить с тем же файлом; идентичность привязана к содержимому.",
                ),
          });
        }
      }
      for (const path of unmatchedPaths)
        report.push({
          slug: "(unmatched)",
          path,
          phase: "mapping",
          status: "blocked",
          nextAction: "Файл не сопоставлен источнику; импорт не выполнялся.",
        });
      for (const path of ambiguousPaths)
        if (!proposals.some((proposal) => proposal.path === path))
          report.push({
            slug: "(ambiguous)",
            path,
            phase: "mapping",
            status: "blocked",
            nextAction:
              "В папке несколько файлов с одним относительным путём; уточнить набор файлов.",
          });
      for (const path of source.картинкиБезТекста)
        report.push({
          slug: "(image-only)",
          path,
          phase: "inventory",
          status: "blocked",
          nextAction:
            "Картинка без текстовой записи; не создаём новую сущность.",
        });
      setOutcomes(report);
      onChanged();
    } catch (reason) {
      setError(
        formatApiError(
          reason,
          "Не удалось выполнить подтверждённый импорт изображений.",
        ),
      );
    } finally {
      setBusy(false);
      setMediaReviewed(false);
    }
  }

  return (
    <section
      className="world-artbook-import"
      aria-label="Импорт артбука Аркен-Хара"
    >
      <h3>Артбук Аркен-Хара</h3>
      <p className="muted">
        Review-first импорт в черновики. Нормализованный checksum относится к
        имени и описанию, а не к исходному HTML. Никаких автоматических
        публикаций или перезаписей.
      </p>
      <Button disabled={busy} onClick={() => void previewText()}>
        {busy ? "Подготавливаем…" : "1. Предварительный просмотр текста"}
      </Button>
      {!!textPlan.length && (
        <div aria-label="Предпросмотр текста">
          <p role="status">
            Создать: {textCounts.create}; уже совпадает: {textCounts.matched};
            конфликт: {textCounts.conflict}; заблокировано: {textCounts.blocked}
            .
          </p>
          <ul>
            {textPlan.map((item) => (
              <li key={item.record.slug}>
                <strong>{item.record.name}</strong> — {item.status};{" "}
                {item.record.sourceUrl}; source ID {item.sourceId}; дата{" "}
                {item.retrievedAt.slice(0, 10)}; нормализованный text SHA{" "}
                {item.record.rawContentHash}
                {item.reason ? `; ${item.reason}` : ""}
                {item.targetIds?.length
                  ? `; target IDs ${item.targetIds.join(", ")}`
                  : ""}
              </li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={textReviewed}
              onChange={(event) => setTextReviewed(event.target.checked)}
            />{" "}
            Я проверил preview и подтверждаю создание только отсутствующих
            записей как DRAFT.
          </label>
          <Button
            disabled={busy || !campaignId || !textReviewed}
            onClick={() => void confirmTextImport()}
          >
            2. Подтвердить создание DRAFT
          </Button>
        </div>
      )}
      <label className="world-artbook-import__folder">
        3. Предложить сопоставления файлов (папка «Артбук»)
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          {...{ webkitdirectory: "" }}
          onChange={(event) => {
            void selectMediaFolder(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {!!proposals.length && (
        <div aria-label="Предпросмотр медиа">
          <p>
            Предложено {mediaReady.length} из {proposals.length}; без файла:{" "}
            {proposals.length - mediaReady.length}; неоднозначные выбранные
            пути: {ambiguousPaths.size}; пути, использованные несколькими
            записями: {ambiguousProposalPaths.size}; неподобранные файлы:{" "}
            {unmatchedPaths.length}; изображения без текста:{" "}
            {source?.картинкиБезТекста.length ?? 0}. Сопоставление по пути —
            предложение, не Eagle ID.
          </p>
          <p className="muted">
            Для безопасного распознавания ранее импортированной галереи нужен
            полный набор файлов каждой выбранной записи; неполная запись будет
            заблокирована до загрузки.
          </p>
          <ul>
            {proposals.map((item) => {
              const file = mediaFiles.get(item.path);
              return (
                <li key={mediaIdentity(item)}>
                  {item.slug}: {item.role} — {item.path};{" "}
                  {file && mediaHashes.get(item.path)
                    ? `binary SHA-256 ${mediaHashes.get(item.path)}`
                    : duplicatePaths.has(item.path) ||
                        ambiguousPaths.has(item.path) ||
                        ambiguousProposalPaths.has(item.path)
                      ? "BLOCKED: неоднозначный путь"
                      : mediaInspectionErrors.get(item.path)
                        ? `BLOCKED: ${mediaInspectionErrors.get(item.path)}`
                        : "missing"}
                  {item.exception
                    ? " — curator exception: Теневая башня ↔ Темная башня.png; требуется явное подтверждение"
                    : ""}
                </li>
              );
            })}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={mediaReviewed}
              onChange={(event) => setMediaReviewed(event.target.checked)}
            />{" "}
            Я проверил каждое показанное сопоставление и разрешаю загрузить
            только полный набор точных путей без конфликтов.
          </label>
          <Button
            disabled={busy || !campaignId || !mediaReviewed}
            onClick={() => void confirmMediaImport()}
          >
            4. Подтвердить сопоставления и загрузку
          </Button>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {!!outcomes.length && (
        <div aria-label="Отчёт импорта">
          <h4>Отчёт (без публикации и автоудаления)</h4>
          <ul>
            {outcomes.map((item, index) => (
              <li
                key={`${item.slug}:${item.path ?? "text"}:${item.phase}:${index}`}
              >
                {item.slug}
                {item.path ? ` / ${item.path}` : ""}: {item.status}, этап{" "}
                {item.phase}
                {item.hash ? `, SHA-256 ${item.hash}` : ""}
                {item.assetId ? `, assetId ${item.assetId}` : ""}
                {item.nextAction ? ` — ${item.nextAction}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

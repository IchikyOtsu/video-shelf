"use client";
/* External channel avatars are returned by YouTube and are not served by Next's optimizer. */
/* eslint-disable @next/next/no-img-element */
import { sourceHealth } from "@/lib/source-health";
import { useMemo, useState } from "react";
import { contentTypes, type ContentType } from "@/lib/library";

export type SourceSummary = {
  id: string;
  name: string;
  feedUrl: string;
  siteUrl: string | null;
  imageUrl: string | null;
  kind: string;
  active: boolean;
  contentType: Exclude<ContentType, "all">;
  category: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  failureCount?: number;
  failureSince?: string | null;
  lastFailureAt?: string | null;
};

function syncLabel(value: string | null) {
  if (!value) return "Jamais actualisée";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Dernière actualisation inconnue"
    : "Dernière réussite : " +
        new Intl.DateTimeFormat("fr-BE", {
          dateStyle: "short",
          timeStyle: "short",
        }).format(date);
}

function SourceAvatar({ source }: { source: SourceSummary }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return source.imageUrl && source.imageUrl !== failedImage ? (
    <img
      className="avatar"
      src={source.imageUrl}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      ref={(image) => {
        if (image?.complete && image.naturalWidth === 0)
          setFailedImage(source.imageUrl);
      }}
      onError={() => setFailedImage(source.imageUrl)}
    />
  ) : (
    <span className="avatar">{source.name[0]?.toUpperCase()}</span>
  );
}

export function SourceBrowser({
  sources,
  loading,
  refreshing,
  cleaningShorts,
  cleanupMore,
  onAdd,
  onOpen,
  onRefresh,
  onEdit,
  onRemove,
  onRemoveShorts,
  onCategory,
  onToggle,
}: {
  sources: SourceSummary[];
  loading: boolean;
  refreshing: boolean;
  cleaningShorts: boolean;
  cleanupMore: boolean;
  onToggle(source: SourceSummary): Promise<void>;
  onCategory(ids: string[], category: string): Promise<void>;
  onAdd(): void;
  onOpen(source: SourceSummary): void;
  onRefresh(source: SourceSummary): void;
  onEdit(source: SourceSummary): void;
  onRemove(source: SourceSummary): void;
  onRemoveShorts(): void;
}) {
  const [grouping, setGrouping] = useState("category");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetCategory, setTargetCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("fr");
    const filtered = term
      ? sources.filter(
          (source) =>
            source.name.toLocaleLowerCase("fr").includes(term) ||
            source.kind.toLocaleLowerCase("fr").includes(term) ||
            source.category.toLocaleLowerCase("fr").includes(term),
        )
      : sources;
    const keys =
      grouping === "category"
        ? [...new Set(filtered.map((source) => source.category))].sort()
        : ["video", "article", "podcast"];
    return keys
      .map((type) => ({
        type,
        label:
          grouping === "category"
            ? type
            : contentTypes[type as Exclude<ContentType, "all">].label,
        sources: filtered.filter(
          (source) =>
            (grouping === "category" ? source.category : source.contentType) ===
            type,
        ),
      }))
      .filter((group) => group.sources.length);
  }, [query, sources, grouping]);
  return (
    <section className="sources-page" aria-label="Gestion des sources">
      <div className="library-toolbar">
        <div>
          <h2>Les sources suivies</h2>
          <p>{sources.length} source(s)</p>
        </div>
        <div className="source-toolbar-actions">
          {sources.some((source) => source.kind === "youtube") ? (
            <button
              className="quiet-button"
              disabled={cleaningShorts}
              onClick={onRemoveShorts}
            >
              {cleaningShorts
                ? "Nettoyage…"
                : cleanupMore
                  ? "Continuer le nettoyage"
                  : "Retirer les Shorts importés"}
            </button>
          ) : null}
          <button className="dark-button" onClick={onAdd}>
            ＋ Ajouter des sources
          </button>
        </div>
      </div>
      <label className="source-search">
        <span>⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une source…"
          aria-label="Rechercher une source"
        />
      </label>
      <div className="category-controls">
        <label>
          Grouper par{" "}
          <select
            value={grouping}
            onChange={(event) => setGrouping(event.target.value)}
          >
            <option value="category">Catégorie</option>
            <option value="type">Type de contenu</option>
          </select>
        </label>
        <button
          className="quiet-button"
          disabled={saving || !sources.length || sources.length > 100}
          onClick={() =>
            setSelected((previous) =>
              previous.size === sources.length
                ? new Set()
                : new Set(sources.map((source) => source.id)),
            )
          }
        >
          Tout sélectionner
        </button>
        {selected.size > 0 && (
          <>
            <input
              list="bulk-source-categories"
              aria-label="Catégorie pour les sources sélectionnées"
              maxLength={80}
              value={targetCategory}
              onChange={(event) => setTargetCategory(event.target.value)}
              placeholder="Choisir ou créer une catégorie"
            />
            <datalist id="bulk-source-categories">
              {[...new Set(sources.map((source) => source.category))].map(
                (value) => (
                  <option key={value} value={value} />
                ),
              )}
            </datalist>
            <button
              className="outline-button"
              disabled={saving || !targetCategory.trim() || selected.size > 100}
              onClick={async () => {
                setSaving(true);
                setError("");
                try {
                  await onCategory([...selected], targetCategory.trim());
                  setSelected(new Set());
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Classement…" : `Classer ${selected.size} source(s)`}
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="list-loading">
          Chargement des sources…
        </p>
      ) : groups.length ? (
        groups.map((group) => {
          const isCollapsed = collapsed.has(group.type);
          return (
            <section className="source-group" key={group.type}>
              <button
                className="source-group-heading"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(group.type)) next.delete(group.type);
                    else next.add(group.type);
                    return next;
                  })
                }
              >
                <span>{group.label}</span>
                <small>{group.sources.length}</small>
                <span aria-hidden="true">{isCollapsed ? "＋" : "−"}</span>
              </button>
              {!isCollapsed ? (
                <div className="source-list">
                  {group.sources.map((source) => (
                    <article className="source-row" key={source.id}>
                      <label className="source-selection">
                        <input
                          type="checkbox"
                          aria-label={"Sélectionner " + source.name}
                          checked={selected.has(source.id)}
                          disabled={saving}
                          onChange={() =>
                            setSelected((previous) => {
                              const next = new Set(previous);
                              if (next.has(source.id)) next.delete(source.id);
                              else next.add(source.id);
                              return next;
                            })
                          }
                        />
                        <SourceAvatar source={source} />
                      </label>
                      <div className="source-details">
                        <h3>{source.name}</h3>
                        <p>
                          {source.kind === "youtube" ? "YouTube" : source.kind}{" "}
                          · {contentTypes[source.contentType].label}
                        </p>
                        <span
                          className={
                            "source-health " + sourceHealth(source).state
                          }
                        >
                          {sourceHealth(source).label}
                        </span>
                        <small
                          title={source.lastSyncError || undefined}
                          className={source.lastSyncError ? "sync-warning" : ""}
                        >
                          {source.lastSyncError
                            ? "⚠ " + source.lastSyncError
                            : syncLabel(source.lastSyncedAt)}
                        </small>
                      </div>
                      <div className="source-actions">
                        <button
                          className="quiet-button"
                          onClick={() => void onToggle(source)}
                        >
                          {source.active ? "Mettre en pause" : "Reprendre"}
                        </button>
                        <button
                          className="quiet-button"
                          onClick={() => onEdit(source)}
                          aria-label={"Modifier " + source.name}
                        >
                          Modifier
                        </button>
                        <button
                          className="outline-button"
                          onClick={() => onOpen(source)}
                        >
                          Voir l’historique
                        </button>
                        <button
                          className="quiet-button"
                          disabled={refreshing}
                          onClick={() => onRefresh(source)}
                        >
                          Actualiser
                        </button>
                        <a
                          href={source.siteUrl || source.feedUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={"Ouvrir " + source.name}
                        >
                          ↗
                        </a>
                        <button
                          className="remove-source"
                          aria-label={"Supprimer " + source.name}
                          onClick={() => onRemove(source)}
                        >
                          ×
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })
      ) : (
        <div className="dashboard-empty">
          <span>◉</span>
          <h2>
            {query ? "Aucune source trouvée" : "Choisis tes premières sources"}
          </h2>
          <p>
            {query
              ? "Essaie un autre nom ou fournisseur."
              : "Suis une chaîne YouTube pour alimenter tes nouveautés."}
          </p>
          {!query ? (
            <button className="dark-button" onClick={onAdd}>
              Ajouter des sources
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

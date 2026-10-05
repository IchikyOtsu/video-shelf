"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import type { ChannelResult } from "@/lib/youtube";
import { request } from "@/lib/client";

export function AddSource({
  feedUrls,
  categories = [],
  onClose,
  onAdded,
}: {
  feedUrls: string[];
  categories?: string[];
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchController = useRef<AbortController | null>(null);
  const [category, setCategory] = useState("Non classé");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"youtube" | "rss">("youtube");
  const [feedUrl, setFeedUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [results, setResults] = useState<ChannelResult[]>([]);
  const [selected, setSelected] = useState<Map<string, ChannelResult>>(
    new Map(),
  );
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [searched, setSearched] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => () => searchController.current?.abort(), []);
  async function searchChannels() {
    if (query.trim().length < 2 || checking || saving) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setChecking(true);
    setError("");
    try {
      const data = await request(
        "/api/youtube/search?q=" + encodeURIComponent(query.trim()),
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setResults(data.channels);
        setSearched(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message);
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  }
  async function add() {
    if (
      (mode === "youtube" && !selected.size) ||
      (mode === "rss" && !feedUrl.trim()) ||
      saving
    )
      return;
    setSaving(true);
    setError("");
    try {
      if (mode === "rss") {
        const data = await request("/api/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "rss",
            feedUrl: feedUrl.trim(),
            name: sourceName.trim() || undefined,
            category: category.trim() || "Non classé",
          }),
        });
        onAdded(
          "1 source ajoutée · " + data.imported + " contenu(s) importé(s).",
        );
        return;
      }
      const data = await request("/api/sources/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: category.trim() || "Non classé",
          sources: [...selected.values()].map((source) => ({
            kind: "youtube",
            channelId: source.channelId,
            name: source.name,
            imageUrl: source.imageUrl,
          })),
        }),
      });
      const addedCount =
        data.added.length +
        data.failed.filter((failure: { added?: boolean }) => failure.added)
          .length;
      onAdded(
        addedCount +
          " source(s) ajoutée(s) · " +
          data.imported +
          " nouveau(x) contenu(s)." +
          (data.alreadyExisting.length
            ? " " + data.alreadyExisting.length + " déjà suivie(s)."
            : "") +
          (data.failed.length
            ? " " + data.failed.length + " erreur(s) à vérifier dans Sources."
            : ""),
      );
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="channel-dialog"
      aria-labelledby="add-source-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div className={"source-form source-form-batch " + mode}>
        <button
          className="close"
          disabled={saving}
          onClick={onClose}
          aria-label="Fermer"
        >
          ×
        </button>
        <div>
          <span className="eyebrow">AJOUTER DES SOURCES</span>
          <h2 id="add-source-title">Qu’aimerais-tu suivre ?</h2>
        </div>
        <div
          className="provider-tabs"
          role="tablist"
          aria-label="Type de source"
        >
          <button
            role="tab"
            aria-selected={mode === "youtube"}
            onClick={() => setMode("youtube")}
          >
            ▷ YouTube
          </button>
          <button
            role="tab"
            aria-selected={mode === "rss"}
            onClick={() => setMode("rss")}
          >
            ≡ RSS / Atom
          </button>
        </div>
        {mode === "youtube" ? (
          <>
            <div className="provider-choice">
              <span>▶</span>
              <div>
                <b>YouTube</b>
                <small>Recherche et ajoute plusieurs chaînes en une fois</small>
              </div>
            </div>
            <label htmlFor="channel-search">
              Rechercher des chaînes YouTube
            </label>
            <input
              id="channel-search"
              type="search"
              maxLength={200}
              value={query}
              disabled={saving}
              autoComplete="off"
              placeholder="Ex. programmation, @arte…"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchChannels();
                }
              }}
              onChange={(event) => {
                searchController.current?.abort();
                setChecking(false);
                setQuery(event.target.value);
                setResults([]);
                setError("");
                setSearched(false);
              }}
            />
            <button
              className="outline-button"
              disabled={saving || checking || query.trim().length < 2}
              onClick={() => void searchChannels()}
            >
              Rechercher
            </button>
            <div className="search-status" role="status">
              {checking
                ? "Recherche sur YouTube…"
                : error
                  ? error
                  : searched
                    ? results.length +
                      " chaîne(s) trouvée(s) · " +
                      selected.size +
                      " sélectionnée(s)"
                    : selected.size
                      ? selected.size +
                        " chaîne(s) sélectionnée(s). Continue ta recherche ou ajoute-les."
                      : "Saisis un nom, puis appuie sur Entrée ou Rechercher. Un @handle ou un lien direct économise le quota de recherche."}
            </div>
            <div
              className="channel-results"
              aria-label="Résultats de recherche"
            >
              {results.map((result) => {
                const added = feedUrls.some((url) =>
                  url.includes(result.channelId),
                );
                const checked = selected.has(result.channelId);
                return (
                  <label
                    key={result.channelId}
                    className={
                      "channel-result " +
                      (checked ? "selected" : "") +
                      (added ? " already-added" : "")
                    }
                  >
                    <input
                      type="checkbox"
                      disabled={saving || added}
                      checked={checked || added}
                      onChange={() =>
                        setSelected((previous) => {
                          const next = new Map(previous);
                          if (next.has(result.channelId))
                            next.delete(result.channelId);
                          else next.set(result.channelId, result);
                          return next;
                        })
                      }
                    />
                    {result.imageUrl ? (
                      <img src={result.imageUrl} alt="" />
                    ) : (
                      <span className="avatar">
                        {result.name[0]?.toUpperCase()}
                      </span>
                    )}
                    <span>
                      <b>{result.name}</b>
                      <small>
                        {added
                          ? "Déjà dans tes sources"
                          : result.description || "Chaîne YouTube"}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
            {searched && !results.length ? (
              <p>
                Aucune chaîne trouvée. Essaie un autre nom ou son lien YouTube.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="provider-choice">
              <span>≡</span>
              <div>
                <b>RSS / Atom</b>
                <small>Ajoute un flux de site, d’articles ou de podcast</small>
              </div>
            </div>
            <label htmlFor="rss-url">URL du flux</label>
            <input
              id="rss-url"
              type="url"
              value={feedUrl}
              disabled={saving}
              placeholder="https://exemple.com/feed.xml"
              onChange={(event) => setFeedUrl(event.target.value)}
              required
            />
            <label htmlFor="rss-name">
              Nom de la source <small>(facultatif)</small>
            </label>
            <input
              id="rss-name"
              type="text"
              value={sourceName}
              disabled={saving}
              placeholder="Déduit automatiquement du flux"
              onChange={(event) => setSourceName(event.target.value)}
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <label htmlFor="new-source-category">
          Catégorie
          <input
            id="new-source-category"
            list="source-categories"
            value={category}
            maxLength={80}
            disabled={saving}
            onChange={(event) => setCategory(event.target.value)}
          />
        </label>
        <datalist id="source-categories">
          {categories.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <div className="source-dialog-footer">
          <span>
            {mode === "youtube"
              ? selected.size + " sélectionnée" + (selected.size > 1 ? "s" : "")
              : "Le flux sera vérifié avant l’ajout"}
          </span>
          <button
            className="dark-button"
            disabled={
              saving || (mode === "youtube" ? !selected.size : !feedUrl.trim())
            }
            onClick={add}
          >
            {saving
              ? "Ajout et synchronisation…"
              : mode === "youtube"
                ? "Ajouter " +
                  selected.size +
                  " source" +
                  (selected.size > 1 ? "s" : "")
                : "Ajouter le flux"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

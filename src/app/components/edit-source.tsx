"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { request } from "@/lib/client";
import type { SourceSummary } from "./source-browser";
export function EditSource({ source, onClose, onSaved }: { source: SourceSummary; onClose(): void; onSaved(source: SourceSummary): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { const data = await request("/api/sources/" + source.id, { method:"PATCH", timeoutMs:30_000, headers:{"Content-Type":"application/json"}, body:JSON.stringify(Object.fromEntries(form)) }); onSaved(data.source); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="channel-dialog edit-source-dialog" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="edit-source-title">
    <form className="source-form" onSubmit={save}>
      <button type="button" className="close" disabled={busy} onClick={onClose} aria-label="Fermer la modification">×</button>
      <h2 id="edit-source-title">Modifier la source</h2>
      <p>Les champs facultatifs laissés vides sont récupérés depuis le flux lors de l’enregistrement.</p>
      <label htmlFor="source-name">Titre</label><input id="source-name" name="name" defaultValue={source.name} maxLength={200} placeholder="Automatique" />
      <label htmlFor="source-feed">Lien du flux ou de la chaîne</label><input id="source-feed" name="feedUrl" type="url" required defaultValue={source.feedUrl} maxLength={2048} />
      <label htmlFor="source-site">Lien du site</label><input id="source-site" name="siteUrl" type="url" defaultValue={source.siteUrl || ""} placeholder="Automatique" maxLength={2048} />
      <label htmlFor="source-image">Image</label><input id="source-image" name="imageUrl" type="url" defaultValue={source.imageUrl || ""} placeholder="Automatique" maxLength={2048} />
      <label htmlFor="source-category">Catégorie</label><input id="source-category" name="category" defaultValue={source.category} maxLength={200} />
      <p>Les contenus collectés, les enregistrements et la progression sont conservés.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="dark-button" disabled={busy}>{busy ? "Vérification…" : "Enregistrer"}</button>
    </form>
  </dialog>;
}

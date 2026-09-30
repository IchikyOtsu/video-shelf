"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type User = { id: string; email: string; name: string | null };
type Source = { id: string; name: string; feedUrl: string; siteUrl: string | null; category: string; kind: string };
const categories = ["Tous", "Vidéos"];

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [sources, setSources] = useState<Source[]>([]);
  const [category, setCategory] = useState("Tous");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(({ user }) => {
      setUser(user);
      if (user) fetch("/api/sources").then(r => r.json()).then(d => setSources(d.sources || []));
    }).catch(() => setUser(null));
  }, []);

  async function signOut() { await fetch("/api/auth/signout", { method: "POST" }); setUser(null); setSources([]); }
  async function addChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), feedUrl: form.get("channel"), category: "Vidéos", kind: "youtube" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Impossible d’ajouter la chaîne."); setSaving(false); return; }
    setSources(current => [...current, data.source].sort((a, b) => a.name.localeCompare(b.name)));
    setSaving(false); setOpen(false);
  }

  if (user === undefined) return <main className="loading">Chargement…</main>;
  if (!user) return <main className="login-home"><Link href="/" className="brand"><span>◒</span>shelf</Link><section><h1>Vos chaînes.<br />Votre rythme.</h1><p>Un lecteur simple pour les vidéos que vous choisissez.</p><div><Link href="/signup" className="dark-button">Créer un compte</Link><Link href="/signin" className="quiet-button">Se connecter</Link></div></section></main>;

  const shown = category === "Tous" ? sources : sources.filter(source => source.category === category);
  return <main className="dashboard">
    <aside className="side">
      <Link href="/" className="brand"><span>◒</span>shelf</Link>
      <button className="add-source" onClick={() => setOpen(true)}>＋ Ajouter une chaîne</button>
      <nav className="main-nav"><button className="nav-active">◷ Boîte de réception</button><button>♡ Enregistrés</button><button>✓ Lus</button></nav>
      <p className="side-label">CATÉGORIES</p>
      <nav className="category-nav">{categories.map(item => <button key={item} className={category === item ? "selected" : ""} onClick={() => setCategory(item)}>{item}<small>{item === "Tous" ? sources.length : sources.length || ""}</small></button>)}</nav>
      <div className="account"><span>{(user.name || user.email)[0].toUpperCase()}</span><div><b>{user.name || user.email.split("@")[0]}</b><button onClick={signOut}>Se déconnecter</button></div></div>
    </aside>
    <section className="dashboard-content">
      <header><div><h1>Boîte de réception</h1><p>{shown.length} chaîne{shown.length !== 1 ? "s" : ""}</p></div><button className="outline-button" onClick={() => setOpen(true)}>Ajouter une chaîne</button></header>
      {shown.length ? <div className="source-list">{shown.map(source => <article key={source.id} className="source-row"><span className="source-dot">{source.name[0].toUpperCase()}</span><div><h2>{source.name}</h2><p>YOUTUBE · FLUX RSS CONNECTÉ</p></div><a href={source.siteUrl || source.feedUrl} target="_blank" rel="noreferrer">Ouvrir ↗</a></article>)}</div> : <div className="dashboard-empty"><span>▶</span><h2>Aucune chaîne</h2><p>Collez l’URL d’une chaîne YouTube. Shelf trouve son flux RSS automatiquement.</p><button className="dark-button" onClick={() => setOpen(true)}>Ajouter une chaîne</button></div>}
    </section>
    {open && <div className="modal-wrap" role="dialog" aria-modal="true"><form className="modal source-form" onSubmit={addChannel}><button className="close" type="button" onClick={() => setOpen(false)}>×</button><h2>Ajouter une chaîne YouTube</h2><p>Collez l’URL de la chaîne ou son handle. Le nom et le flux RSS sont trouvés automatiquement.</p><label>URL ou handle YouTube<input name="channel" placeholder="https://youtube.com/@veritasium ou @veritasium" required /></label><label>Nom <small>(facultatif)</small><input name="name" placeholder="Laisser vide pour détecter le nom" /></label>{error && <p className="form-error">{error}</p>}<button className="dark-button" disabled={saving}>{saving ? "Recherche du flux…" : "Ajouter la chaîne"}</button></form></div>}
  </main>;
}

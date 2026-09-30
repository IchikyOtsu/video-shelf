"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type User = { id: string; email: string; name: string | null };
const categories = ["Articles", "Vidéos", "Podcasts", "Newsletters", "Livres", "Événements"];

export default function Home() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [showSource, setShowSource] = useState(false);
  useEffect(() => { fetch("/api/auth/me").then((r) => r.json()).then(({ user }) => setUser(user)).catch(() => setUser(null)); }, []);
  async function signOut() { await fetch("/api/auth/signout", { method: "POST" }); setUser(null); }

  return <main className="app-shell">
    <header className="topbar"><Link href="/" className="brand"><span>◒</span>shelf</Link><nav>{user ? <><span className="hello">Bonjour{user.name ? `, ${user.name}` : ""}</span><button onClick={signOut} className="quiet-button">Se déconnecter</button></> : user === undefined ? <span className="hello">Chargement…</span> : <><Link href="/signin" className="quiet-button">Se connecter</Link><Link href="/signup" className="dark-button">Créer un compte</Link></>}</nav></header>
    <section className="hero"><p className="eyebrow">VOTRE INTERNET, SANS LE BRUIT</p><h1>Tout ce que vous voulez suivre.<br/><em>Rien qui vous absorbe.</em></h1><p className="intro">Shelf réunit vos sources choisies dans un seul endroit calme. Pas de recommandations, pas de fil infini, pas de notifications qui réclament votre attention.</p>{user ? <button className="dark-button large" onClick={() => setShowSource(true)}>+ Ajouter ma première source</button> : <Link href="/signup" className="dark-button large">Créer mon espace</Link>}</section>
    <section className="feature-grid"><div className="feature-card"><span className="feature-icon">◎</span><h2>Une seule boîte de réception</h2><p>RSS, vidéos, podcasts et newsletters arrivent au même endroit, dans l’ordre que vous choisissez.</p></div><div className="feature-card"><span className="feature-icon">◇</span><h2>Des catégories claires</h2><p>{categories.join(" · ")}. Vous décidez de ce qui mérite une place sur votre Shelf.</p></div><div className="feature-card"><span className="feature-icon">◷</span><h2>À votre rythme</h2><p>Sauvegardez, lisez plus tard, ou marquez comme vu. Sans compteur, ni pression.</p></div></section>
    <section className="empty-state"><div className="empty-art">✦</div><p className="eyebrow">VOTRE BIBLIOTHÈQUE</p><h2>Prête quand vous l’êtes.</h2><p>{user ? "Ajoutez une source pour commencer à construire un fil qui vous ressemble." : "Créez un compte pour enregistrer vos sources et retrouver votre bibliothèque sur tous vos appareils."}</p></section>
    {showSource && <div className="modal-wrap" role="dialog" aria-modal="true"><div className="modal"><button className="close" onClick={() => setShowSource(false)}>×</button><span className="feature-icon">＋</span><h2>Ajout des sources</h2><p>Votre compte est prêt. L’import RSS sera connecté à la base de données dans la prochaine étape ; le modèle de données est déjà en place.</p><button className="dark-button" onClick={() => setShowSource(false)}>Compris</button></div></div>}
  </main>;
}

"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function SignIn() {
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setLoading(true); setError(""); const form = new FormData(e.currentTarget); const response = await fetch("/api/auth/signin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) }); const data = await response.json(); if (!response.ok) { setError(data.error); setLoading(false); return; } router.push("/"); router.refresh(); }
  return <main className="auth-page"><section className="auth-card"><Link className="brand" href="/"><span>◒</span>shelf</Link><h1>Bon retour.</h1><p>Retrouvez votre bibliothèque, à votre rythme.</p><form className="auth-form" onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>{error && <div className="form-error">{error}</div>}<button className="dark-button" disabled={loading}>{loading ? "Connexion…" : "Se connecter"}</button></form><p className="auth-switch">Pas encore de compte ? <Link href="/signup">Créer mon espace</Link></p></section></main>;
}

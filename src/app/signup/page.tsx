"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function SignUp() {
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const router = useRouter();
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setLoading(true); setError(""); const form = new FormData(e.currentTarget); const response = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email: form.get("email"), password: form.get("password") }) }); const data = await response.json(); if (!response.ok) { setError(data.error); setLoading(false); return; } router.push("/"); router.refresh(); }
  return <main className="auth-page"><section className="auth-card"><Link className="brand" href="/"><span>◒</span>shelf</Link><h1>Créer votre espace.</h1><p>Vos sources et votre lecture restent à vous.</p><form className="auth-form" onSubmit={submit}><label>Prénom <small>(facultatif)</small><input name="name" type="text" autoComplete="name" /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Mot de passe <small>(8 caractères minimum)</small><input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>{error && <div className="form-error">{error}</div>}<button className="dark-button" disabled={loading}>{loading ? "Création…" : "Créer mon espace"}</button></form><p className="auth-switch">Déjà un compte ? <Link href="/signin">Se connecter</Link></p></section></main>;
}

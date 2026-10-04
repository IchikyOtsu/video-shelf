"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
export default function VerifyEmail() { const token = useSearchParams().get("token"); const [message, setMessage] = useState("Vérification en cours…"); useEffect(() => { fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }).then(r => setMessage(r.ok ? "Votre e-mail est vérifié." : "Ce lien est invalide ou expiré.")); }, [token]); return <main className="auth-page"><section className="auth-card"><Link className="brand" href="/"><span>◒</span>shelf</Link><h1>{message}</h1><p className="auth-switch"><Link href="/">Retour à la bibliothèque</Link></p></section></main>; }

"use client";
import QRCode from "qrcode";
/* A generated data URL is not served by Next's image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { FormEvent, useEffect, useState } from "react";
import { request } from "@/lib/client";

type Account = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
};
type Props = { onClose(): void; onSignOut(): void };
export function AccountSettings({ onClose, onSignOut }: Props) {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [mode, setMode] = useState<
    "" | "password" | "setup" | "confirm" | "disable" | "codes" | "delete"
  >("");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    request("/api/account")
      .then((data) => {
        if (live) setAccount(data.user);
      })
      .catch((e) => {
        if (live) setError(e.message || "Impossible de charger les réglages.");
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  async function action(url: string, body?: object) {
    setBusy(url);
    setError("");
    setNotice("");
    try {
      const data = await request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      return data;
    } catch (e) {
      setError((e as Error).message || "Cette action a échoué.");
      return null;
    } finally {
      setBusy("");
    }
  }
  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm"))
      return setError("Les mots de passe ne correspondent pas.");
    const data = await action("/api/account/password", {
      currentPassword: form.get("currentPassword"),
      password: form.get("password"),
    });
    if (data) {
      setMode("");
      setNotice(
        "Mot de passe modifié. Reconnectez-vous sur vos autres appareils.",
      );
    }
  }
  async function setup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await action("/api/account/totp/setup", {
      currentPassword: new FormData(event.currentTarget).get("currentPassword"),
    });
    if (data) {
      setSecret(data.secret);
      setQr(await QRCode.toDataURL(data.otpauthUrl));
      setMode("confirm");
    }
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await action("/api/account/totp/confirm", {
      code: new FormData(event.currentTarget).get("code"),
    });
    if (data) {
      setCodes(data.recoveryCodes);
      setSecret("");
      setQr("");
      setAccount((value) => value && { ...value, totpEnabled: true });
      setMode("codes");
    }
  }
  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await action("/api/account/totp/disable", {
      currentPassword: form.get("currentPassword"),
      code: form.get("code"),
    });
    if (data) {
      setAccount((value) => value && { ...value, totpEnabled: false });
      setMode("");
      setNotice("La double authentification est désactivée.");
    }
  }
  async function removeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("delete");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: form.get("currentPassword"),
          code: form.get("code"),
          confirmation: form.get("confirmation"),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.error || "Impossible de supprimer le compte.");
      onSignOut();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div
      className="settings-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header>
          <div>
            <p className="eyebrow">COMPTE</p>
            <h2 id="settings-title">Réglages</h2>
          </div>
          <button
            className="close"
            onClick={onClose}
            aria-label="Fermer les réglages"
          >
            ×
          </button>
        </header>
        {!account ? (
          <p className="settings-status">
            {error || "Chargement des réglages…"}
          </p>
        ) : (
          <div className="settings-body">
            <section>
              <h3>Profil</h3>
              <p>
                <b>{account.name || "Sans nom"}</b>
                <br />
                {account.email}
              </p>
              <p
                className={
                  account.emailVerified ? "security-good" : "security-pending"
                }
              >
                {account.emailVerified
                  ? "✓ E-mail vérifié"
                  : "! E-mail non vérifié"}
              </p>
              {!account.emailVerified && (
                <button
                  className="outline-button"
                  disabled={busy !== ""}
                  onClick={async () => {
                    const data = await action(
                      "/api/account/resend-verification",
                    );
                    if (data)
                      setNotice(
                        data.sent
                          ? "E-mail de vérification envoyé."
                          : "E-mail non configuré : ajoutez RESEND_API_KEY et EMAIL_FROM.",
                      );
                  }}
                >
                  Renvoyer le lien
                </button>
              )}
            </section>
            <section>
              <h3>Sécurité</h3>
              <button
                className="settings-action"
                onClick={() => setMode("password")}
              >
                Changer le mot de passe <span>›</span>
              </button>
              <div className="totp-row">
                <div>
                  <b>Double authentification</b>
                  <small>
                    {account.totpEnabled ? "Activée" : "Non activée"}
                  </small>
                </div>
                {account.totpEnabled ? (
                  <div>
                    <button
                      className="quiet-button"
                      onClick={() => setMode("codes")}
                    >
                      Codes
                    </button>
                    <button
                      className="quiet-button danger"
                      onClick={() => setMode("disable")}
                    >
                      Désactiver
                    </button>
                  </div>
                ) : (
                  <button
                    className="outline-button"
                    onClick={() => setMode("setup")}
                  >
                    Activer
                  </button>
                )}
              </div>
            </section>
            <section>
              <button className="settings-signout" onClick={onSignOut}>
                Se déconnecter
              </button>
            </section>
            <section className="danger-zone">
              <h3>Zone dangereuse</h3>
              <p>Supprime définitivement votre compte, vos sources et vos données associées.</p>
              <button className="outline-button danger" onClick={() => setMode("delete")}>Supprimer mon compte</button>
            </section>
            {notice && (
              <p className="settings-success" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {mode === "password" && (
              <form className="settings-form" onSubmit={submitPassword}>
                <h3>Changer le mot de passe</h3>
                <input
                  name="currentPassword"
                  type="password"
                  placeholder="Mot de passe actuel"
                  required
                />
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  placeholder="Nouveau mot de passe"
                  required
                />
                <input
                  name="confirm"
                  type="password"
                  minLength={8}
                  placeholder="Confirmer le mot de passe"
                  required
                />
                <button className="dark-button" disabled={Boolean(busy)}>
                  Enregistrer
                </button>
              </form>
            )}
            {mode === "setup" && (
              <form className="settings-form" onSubmit={setup}>
                <h3>Activer la double authentification</h3>
                <p>Confirmez votre mot de passe avant de créer votre clé.</p>
                <input
                  name="currentPassword"
                  type="password"
                  placeholder="Mot de passe actuel"
                  required
                />
                <button className="dark-button" disabled={Boolean(busy)}>
                  Continuer
                </button>
              </form>
            )}
            {mode === "confirm" && (
              <form className="settings-form" onSubmit={confirm}>
                <h3>Scannez le QR code</h3>
                {qr && (
                  <img
                    className="totp-qr"
                    src={qr}
                    alt="QR code pour votre application d’authentification"
                  />
                )}
                <p>
                  Ou saisissez cette clé : <code>{secret}</code>
                </p>
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Code à 6 chiffres"
                  required
                />
                <button className="dark-button" disabled={Boolean(busy)}>
                  Confirmer et activer
                </button>
              </form>
            )}
            {mode === "codes" && (
              <section className="settings-form">
                <h3>Codes de récupération</h3>
                {codes.length ? (
                  <>
                    <p>
                      Conservez-les hors ligne. Ils ne seront plus affichés.
                    </p>
                    <pre>{codes.join("\n")}</pre>
                  </>
                ) : (
                  <p>
                    Les codes de récupération sont affichés uniquement lors de
                    leur génération. Vous pouvez désactiver puis réactiver le
                    TOTP pour en créer de nouveaux.
                  </p>
                )}
                <button
                  className="outline-button"
                  onClick={() => {
                    setCodes([]);
                    setMode("");
                  }}
                >
                  Fermer
                </button>
              </section>
            )}
            {mode === "disable" && (
              <form className="settings-form" onSubmit={disable}>
                <h3>Désactiver la double authentification</h3>
                <input
                  name="currentPassword"
                  type="password"
                  placeholder="Mot de passe actuel"
                  required
                />
                <input
                  name="code"
                  inputMode="numeric"
                  placeholder="Code d’authentification"
                  required
                />
                <button
                  className="outline-button danger"
                  disabled={Boolean(busy)}
                >
                  Désactiver
                </button>
              </form>
            )}
            {mode === "delete" && (
              <form className="settings-form danger-zone" onSubmit={removeAccount}>
                <h3>Supprimer définitivement le compte</h3>
                <p>Cette action est irréversible. Tapez SUPPRIMER pour confirmer.</p>
                <input name="currentPassword" type="password" placeholder="Mot de passe actuel" required />
                {account.totpEnabled && <input name="code" placeholder="Code TOTP ou code de récupération" required />}
                <input name="confirmation" placeholder="SUPPRIMER" required />
                <button className="outline-button danger" disabled={Boolean(busy)}>Supprimer définitivement</button>
              </form>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

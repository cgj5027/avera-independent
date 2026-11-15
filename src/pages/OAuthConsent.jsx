import React, { useEffect, useState } from "react";
import { application } from "@/api/application";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

// The server owns and expires opaque OAuth handles; the browser never accepts raw redirect URIs.
export default function OAuthConsent() {
  const ctx = new URLSearchParams(window.location.search).get("ctx");
  const [info, setInfo] = useState(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [decided, setDecided] = useState("");
  const [error, setError] = useState("");
  const [reconnect, setReconnect] = useState("");

  useEffect(() => {
    (async () => {
      let redirecting = false;
      try {
        if (!ctx) {
          setError("This authorization link is invalid or has expired.");
          return;
        }
        // Resolve the handle first: a dead handle must never render
        // approve/deny, and the response carries the app's configured login
        // route for the signed-out redirect below. Send the session (cookie +
        // bearer token) so the server can list the granted tools for a
        // signed-in user — the same auth the approve/deny call sends; without
        // it the display request is anonymous and shows no tools.
        const res = await application.consent.getInfo(ctx);
        if (!res.ok) {
          setError("This authorization link is invalid or has expired.");
          return;
        }
        const data = await res.json();
        // Use the consent server's authentication result. A client-side session
        // hint cannot verify a cookie-only session or this authorization handle.
        if (!data.authenticated) {
          // The short handle rides back in returnTo; login_path is
          // owner-configured and validated server-side as a same-origin path.
          // Preserve only the server-owned handle through the sign-in round trip.
          const returnTo =
            window.location.pathname + "?ctx=" + encodeURIComponent(ctx);
          const encoded = encodeURIComponent(returnTo);
          redirecting = true; // keep the spinner while the browser navigates
          window.location.href =
            (data.login_path || "/login") + "?returnTo=" + encoded + "&from_url=" + encoded;
          return;
        }
        setInfo(data);
      } catch (e) {
        setError("Could not load this authorization request. Please try again.");
      } finally {
        if (!redirecting) setChecking(false);
      }
    })();
  }, [ctx]);

  const respond = async (action) => {
    setSubmitting(true);
    setError("");
    try {
      // Cookie-backed sessions carry no token; sending "Bearer null" would
      // shadow the valid cookie, so add the header only when a token exists.
      const res = await application.consent.respond(ctx, action);
      if (!res.ok) {
        // 401 = the session expired before the (single-use, still-unconsumed)
        // handle was spent; retrying the same controls re-sends the dead session
        // forever. Send the user back through login preserving `ctx` — the same
        // redirect the initial signed-out path uses — so they can return and
        // approve the still-valid handle.
        if (res.status === 401) {
          const returnTo = window.location.pathname + "?ctx=" + encodeURIComponent(ctx);
          const encoded = encodeURIComponent(returnTo);
          window.location.href =
            ((info && info.login_path) || "/login") + "?returnTo=" + encoded + "&from_url=" + encoded;
          return;
        }
        // Expired/used handles, account mismatches and changed permissions
        // require a fresh client flow instead of repeated submissions here.
        if ([400, 403, 404, 409].includes(res.status)) {
          let detail = "";
          try { detail = (await res.json()).detail; } catch (_) { /* keep default */ }
          setReconnect(detail || "This authorization can no longer be completed. Reconnect from your AI client to try again.");
          setSubmitting(false);
          return;
        }
        throw new Error("Could not complete authorization. Please try again.");
      }
      const data = await res.json();
      window.location.href = data.redirect_url;
      if (!/^https?:/i.test(data.redirect_url)) {
        // Custom-scheme redirect (native AI clients, e.g. cursor://): browsers
        // may block or not visibly navigate, so show a terminal state instead
        // of an eternal spinner.
        setDecided(action);
        setSubmitting(false);
      }
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <AuthLayout icon={ShieldCheck} title="Authorize access">
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      </AuthLayout>
    );
  }

  const client = (info && info.client_name) || "An AI client";
  const appName = (info && info.app_name) || "this app";

  if (decided) {
    return (
      <AuthLayout
        icon={ShieldCheck}
        title={decided === "approve" ? "Access granted" : "Access denied"}
        subtitle={`You can return to ${client} and close this window.`}
      />
    );
  }

  // Terminal: the authorization request is no longer valid (tool set changed +
  // handle consumed). Retrying can't succeed, so show reconnect guidance with
  // no approve/deny controls.
  if (reconnect) {
    return (
      <AuthLayout icon={ShieldCheck} title="Reconnect required">
        <div className="p-3 rounded-lg bg-danger-surface text-danger-text text-sm">
          {reconnect}
        </div>
      </AuthLayout>
    );
  }

  // No consent details means nothing trustworthy to approve: a failed
  // consent-info load (expired handle, rate limit, transient error) renders
  // the error alone, never the approve/deny controls.
  if (error && !info) {
    return (
      <AuthLayout icon={ShieldCheck} title="Authorize access">
        <div className="p-3 rounded-lg bg-danger-surface text-danger-text text-sm">
          {error}
        </div>
      </AuthLayout>
    );
  }

  const tools = Array.isArray(info.tools) ? info.tools : [];

  return (
    <AuthLayout
      icon={ShieldCheck}
      title="Authorize access"
      subtitle={`${client} wants to access ${appName} on your behalf`}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-danger-surface text-danger-text text-sm">
          {error}
        </div>
      )}

      {info.account_email && <p className="mb-2 text-sm text-muted-foreground">Signed in as {info.account_email}</p>}
      {info.redirect_origin && <p className="mb-3 break-words text-sm text-muted-foreground">Client redirect: {info.redirect_origin}. Client names are supplied by the client; approve only a connection you started and trust.</p>}
      <p className="mb-4 text-sm text-muted-foreground">Approval shares your personal records with this client. It can retain information it receives. Sample records, private files and provider credentials are excluded. You can revoke future access in Settings → General → Connected AI clients.</p>
      <p className="text-sm font-medium text-foreground mb-2">
        {tools.length ? `It will be able to use these tools in ${appName}:` : "No tools requested"}
      </p>
      {tools.length > 0 && (
        <ul className="space-y-2 text-sm mb-6">
          {tools.map((tool) => (
            <li key={tool.name} className="flex flex-col">
              <span className="text-foreground font-medium">
                {tool.title || tool.name}
              </span>
              {tool.description && (
                <span className="text-muted-foreground">{tool.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 h-12 font-medium"
          disabled={submitting}
          onClick={() => respond("deny")}
        >
          Deny
        </Button>
        <Button
          className="flex-1 h-12 font-medium"
          disabled={submitting}
          onClick={() => respond("approve")}
        >
          {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Approve
        </Button>
      </div>
    </AuthLayout>
  );
}

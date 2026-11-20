import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page } from "@/components/Page";
import { useAuth } from "@/components/auth";
import { ClaimBadge } from "@/components/StatusBadge";
import {
  errorMessage,
  ghChallenge,
  ghVerify,
  listClaims,
  listTokens,
  mintToken,
  revokeToken,
  unlinkGithub,
  type ApiTokenRecord,
  type Claim,
} from "@/lib/client";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user, loading, refresh } = useAuth();
  const [nonce, setNonce] = useState("");
  const [gistUrl, setGistUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const [tokens, setTokens] = useState<ApiTokenRecord[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [tokenName, setTokenName] = useState("");

  const reload = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([listTokens(), listClaims()]);
      setTokens(t.tokens);
      setClaims(c.claims);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (user) void reload();
  }, [user, reload]);

  async function startLink() {
    setLinking(true);
    try {
      const res = await ghChallenge();
      setNonce(res.nonce);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLinking(false);
    }
  }

  async function verifyLink() {
    setLinking(true);
    try {
      await ghVerify(gistUrl);
      toast.success("GitHub linked");
      setNonce("");
      setGistUrl("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLinking(false);
    }
  }

  async function unlink() {
    try {
      await unlinkGithub();
      toast.success("GitHub unlinked");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function mint() {
    try {
      const res = await mintToken(tokenName || undefined);
      setNewSecret(res.token);
      setTokenName("");
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function revoke(id: number) {
    try {
      await revokeToken(id);
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (loading) {
    return (
      <Page>
        <p>Loading profile.</p>
      </Page>
    );
  }

  if (!user) {
    return (
      <Page>
        <div className="flex max-w-md flex-col gap-4">
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p>
            <Link to="/login" className="underline">Log in</Link> to see your profile.
          </p>
        </div>
      </Page>
    );
  }

  const myClaims = claims.filter(
    (c) => c.user === user.display_name || (user.github_login && c.user === `@${user.github_login}`),
  );

  return (
    <Page>
      <div className="flex max-w-2xl flex-col gap-8">
        <section className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Profile</h1>
          <p className="text-muted-foreground">{user.email}</p>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">GitHub link</h2>
          {user.github_login ? (
            <div className="flex items-center gap-2">
              <p className="text-sm">
                Linked as <span className="font-medium">@{user.github_login}</span>
              </p>
              <Button variant="outline" size="sm" onClick={unlink} className="ml-auto">
                Unlink
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {nonce
                  ? `Create a secret gist containing: ${nonce}`
                  : "Linking proves you own a GitHub account."}
              </p>
              {!nonce ? (
                <Button size="sm" onClick={startLink} disabled={linking} className="self-start">
                  Get link code
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="rounded-md bg-neutral-100 p-2 font-mono text-sm dark:bg-neutral-800">
                    {nonce}
                  </p>
                  <label htmlFor="gist-url" className="text-sm font-medium">
                    Secret gist URL
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="gist-url"
                      value={gistUrl}
                      onChange={(e) => setGistUrl(e.target.value)}
                      placeholder="https://gist.github.com/you/abc123"
                    />
                    <Button size="sm" onClick={verifyLink} disabled={linking || !gistUrl}>
                      Verify
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Tracker tokens</h2>
          {newSecret ? (
            <p className="rounded-md bg-neutral-100 p-2 font-mono text-sm break-all dark:bg-neutral-800">
              {newSecret}
            </p>
          ) : null}
          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{t.name || t.prefix}</span>
                  <span className="text-muted-foreground">{t.created}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revoke(t.id)}
                    className="ml-auto"
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="token-name" className="text-sm font-medium">
              Token name
            </label>
            <div className="flex gap-2">
              <Input
                id="token-name"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="laptop-cli"
              />
              <Button size="sm" onClick={mint}>
                Mint token
              </Button>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">My claims</h2>
          {myClaims.length === 0 ? (
            <p className="text-sm text-muted-foreground">No claims yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {myClaims.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <ClaimBadge status={c.status} />
                  <Link to="/device/$slug" params={{ slug: c.device_slug }} className="underline">
                    {c.device_slug}
                  </Link>
                  <span className="text-muted-foreground">{c.note}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Page>
  );
}

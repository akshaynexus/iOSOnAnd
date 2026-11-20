import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AuthFields {
  email: string;
  password: string;
  displayName: string;
}

export function AuthForm({
  mode,
  onSubmit,
  pending,
}: {
  mode: "login" | "signup";
  onSubmit: (fields: AuthFields) => Promise<void>;
  pending: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await onSubmit({ email, password, displayName });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {mode === "signup" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="display-name" className="text-sm font-medium">Display name</label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="rina-kernel"
            autoComplete="nickname"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">Email</label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
        />
      </div>
      <Button type="submit" disabled={pending}>
        {mode === "signup" ? "Create account" : "Log in"}
      </Button>
    </form>
  );
}

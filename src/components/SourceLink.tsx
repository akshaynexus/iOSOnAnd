import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// A status row's source is free text: a Reddit permalink, a GitHub URL, any
// other URL, or a OneiOS doc reference such as "README#known-issues,
// docs/hardware.md §5". Show a short badge that links to it; the full text
// stays in the tooltip.

const ONEIOS = "https://github.com/akshaynexus/OneiOS";

type Resolved = { label: string; href: string | null };

export function resolveSource(raw: string): Resolved {
  const s = raw.trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const host = u.hostname.replace(/^www\.|^old\./, "");
      if (host === "reddit.com" || host === "redd.it") return { label: "Reddit post", href: s };
      if (host === "hakios-developers.com") return { label: "HakiOS registry", href: s };
      if (host === "github.com") {
        const [owner, repo] = u.pathname.split("/").filter(Boolean);
        return { label: repo ? `${owner}/${repo}` : "GitHub", href: s };
      }
      return { label: host, href: s };
    } catch {
      return { label: s, href: null };
    }
  }
  const readme = /^README(#[\w-]+)?/.exec(s);
  if (readme) return { label: "OneiOS README", href: `${ONEIOS}/blob/main/README.md${readme[1] ?? ""}` };
  const doc = /^(docs\/[\w./-]+\.md)/.exec(s);
  if (doc) return { label: doc[1].replace(/^docs\//, ""), href: `${ONEIOS}/blob/main/${doc[1]}` };
  return { label: s, href: null };
}

export function SourceLink({ source }: { source: string }) {
  if (!source.trim()) return null;
  const { label, href } = resolveSource(source);
  if (!href) {
    return (
      <Badge variant="outline" className="max-w-full truncate font-normal" title={source}>
        {label}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="max-w-full font-normal pointer-coarse:h-8 pointer-coarse:px-2.5"
      render={<a href={href} target="_blank" rel="noopener noreferrer" title={source} />}
    >
      <span className="truncate">{label}</span>
      <ExternalLink data-icon="inline-end" aria-hidden />
    </Badge>
  );
}

// Free text (fork notes, device notes) with any URLs in it shown as badges.
export function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s),]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <SourceLink key={i} source={p} />
        ) : (
          <span key={i}>{p.replace(/\bsource:\s*$/i, "")}</span>
        ),
      )}
    </>
  );
}

/**
 * Marketing footer — short, no chrome. Surfaces both:
 *  - the GitHub repo (this codebase) for self-hosters
 *  - the project home (listbull.org) for "what is this" / install docs
 */
import { GITHUB_URL, PROJECT_HOME_URL } from "@/components/marketing/links";

type FooterProps = {
  hostedLabel: string;
  licenseLabel: string;
  copyrightLabel: string;
  projectHomeLabel?: string;
};

export function Footer({
  hostedLabel,
  licenseLabel,
  copyrightLabel,
  projectHomeLabel = "Project home & install docs",
}: FooterProps) {
  return (
    <footer
      style={{
        padding: "var(--lb-sp-8) var(--lb-sp-4)",
        textAlign: "center",
        borderTop: "1px solid var(--lb-border)",
      }}
    >
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: "var(--lb-sp-2)",
          fontSize: "var(--lb-fs-sm)",
          color: "var(--lb-muted-fg)",
        }}
      >
        <li>
          <a
            href={PROJECT_HOME_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            {projectHomeLabel} → {PROJECT_HOME_URL.replace("https://", "")}
          </a>
        </li>
        <li>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            {GITHUB_URL.replace("https://", "")}
          </a>
        </li>
        <li>{hostedLabel}</li>
        <li>{licenseLabel}</li>
        <li>{copyrightLabel}</li>
      </ul>
    </footer>
  );
}

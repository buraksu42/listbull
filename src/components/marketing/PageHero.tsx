import Link from "next/link";

type Props = {
  eyebrow?: string;
  title: string;
  lead?: string;
  ctas?: React.ReactNode;
  /** A "← Back to …" link rendered above the eyebrow / title. */
  backHref?: string;
  backLabel?: string;
};

export function PageHero({
  eyebrow,
  title,
  lead,
  ctas,
  backHref,
  backLabel,
}: Props) {
  return (
    <div className="page-hero">
      <div className="container">
        {backHref ? (
          <Link href={backHref} className="back-link">
            ← {backLabel ?? "Back"}
          </Link>
        ) : null}
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {ctas ? <div className="hero-ctas">{ctas}</div> : null}
      </div>
    </div>
  );
}

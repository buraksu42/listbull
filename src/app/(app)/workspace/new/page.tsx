import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { CreateWorkspaceForm } from "@/components/workspace/create-form";

export const dynamic = "force-dynamic";

/**
 * Workspace creation form. Phase 4.5 logs tier-exceeded attempts;
 * Phase 5 will return 402 + upgrade CTA when Free-tier users try
 * to create a 2nd workspace.
 */
export default function NewWorkspacePage() {
  return (
    <main style={{ paddingBottom: "var(--lb-sp-12)" }}>
      <header
        style={{
          height: "var(--lb-header-h)",
          padding: "0 var(--lb-sp-3)",
          display: "flex",
          alignItems: "center",
          gap: "var(--lb-sp-2)",
          borderBottom: "1px solid var(--lb-border)",
        }}
      >
        <Link
          href="/lists"
          aria-label="Back"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            color: "var(--lb-fg)",
          }}
        >
          <ChevronLeft width={20} height={20} aria-hidden />
        </Link>
        <h1
          style={{
            fontSize: "var(--lb-fs-lg)",
            fontWeight: "var(--lb-fw-semibold)",
          }}
        >
          New workspace
        </h1>
      </header>

      <div style={{ padding: "var(--lb-sp-4)" }}>
        <CreateWorkspaceForm />
      </div>
    </main>
  );
}

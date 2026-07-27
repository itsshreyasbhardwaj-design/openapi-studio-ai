import { StudioShell } from "@/components/studio/shell";
import { currentIdentity } from "@/lib/server/auth";
import { capabilities } from "@/lib/server/env";

export const dynamic = "force-dynamic";

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const identity = await currentIdentity();
  return (
    <StudioShell capabilities={capabilities()} identityName={identity.displayName}>
      {children}
    </StudioShell>
  );
}

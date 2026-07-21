import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth/session";
import { getCurrentUser } from "@/lib/gateway";
import { SkinAuthenticatedShell } from "@/skin";
import { clientConfig } from "../../client.config";

export default async function AuthenticatedLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  const session = getSession();

  if (!session) {
    redirect("/login");
  }

  const currentUser = await getCurrentUser(session).catch(() => null);

  return (
    <SkinAuthenticatedShell
      currentUser={currentUser}
      features={clientConfig.features}
      session={session}
    >
      {children}
    </SkinAuthenticatedShell>
  );
}

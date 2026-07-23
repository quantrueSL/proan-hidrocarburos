import { requireSession } from "@/lib/auth/session";
import { getDashboard } from "@/lib/gateway";
import { DashboardWorkspace } from "@/features/dashboard/dashboard-workspace";
import type { DashboardData } from "@/types/dashboard";

export default async function DashboardPage() {
  const session = requireSession();
  let data: DashboardData | null = null;
  let error: string | null = null;

  try {
    data = await getDashboard(session);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No se pudo preparar el dashboard.";
  }

  return <DashboardWorkspace initialData={data} initialError={error} />;
}

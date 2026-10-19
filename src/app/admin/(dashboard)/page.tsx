import { requireOps } from "@/lib/auth/roles";
import { getAttentionQueue } from "@/app/actions/attention";
import { readSectorLens } from "@/lib/sector-lens.server";
import { AttentionQueueView } from "@/components/admin/attention-queue";
import { SectorLens } from "@/components/admin/sector-lens";

/**
 * Admin home = "Hari Ini".
 *
 * Replaces a 450-line cockpit of four KPI cards, a sector strip, an action list
 * and a 5-day agenda — all of which read from tables that did not exist and
 * invented financial figures. Those numbers were worse than nothing: a
 * dashboard that lies is less useful than one that says "belum ada data".
 *
 * The home screen is now a ranked work queue. Everything shown is computed from
 * live data, every row has the action that resolves it, and when the queue is
 * empty the page says so plainly so the operator can stop working.
 */
export default async function AdminHomePage() {
  const { admin } = await requireOps();
  const [queue, lens] = await Promise.all([getAttentionQueue(), readSectorLens()]);

  return (
    <div className="space-y-5">
      <SectorLens active={lens} />
      <AttentionQueueView queue={queue} ownerName={admin.display_name} />
    </div>
  );
}

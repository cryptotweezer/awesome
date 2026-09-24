import { listLoans } from "@/lib/data/loans";
import { awesomeForPage } from "@/lib/data/org";
import { vaultLedger, vaultStatus } from "@/lib/data/vault";
import { todayInSydney } from "@/lib/format";
import { VaultManager } from "./vault-manager";

/**
 * The vault: what has actually been saved, as opposed to what the weeks were
 * worth.
 *
 * It has its own page and not a panel on the overview because it answers a
 * different question. The overview is about this month; this is about the whole
 * plan, and about money that has already stopped being income.
 *
 * The loans are here too, because paying one out of the saving is one of the few
 * things that legitimately takes money out of it. The payment is still a loan
 * payment, recorded once.
 */
export default async function SavingsVaultPage() {
  const org = await awesomeForPage();
  const [status, ledger, loans] = await Promise.all([
    vaultStatus(org.id),
    vaultLedger(org.id),
    listLoans(org.id, { activeOnly: true }),
  ]);

  return (
    <VaultManager
      status={status}
      ledger={ledger}
      loans={loans.filter((l) => l.balance > 0)}
      today={todayInSydney()}
    />
  );
}

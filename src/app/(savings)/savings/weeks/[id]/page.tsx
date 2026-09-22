import { notFound } from "next/navigation";
import { listClients } from "@/lib/data/clients";
import { listExpenseItems } from "@/lib/data/expenses";
import { awesomeForPage } from "@/lib/data/org";
import { getWeekDetail, syncWeek } from "@/lib/data/weeks";
import { todayInSydney } from "@/lib/format";
import { WeekView } from "./week-view";

export default async function WeekPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const org = await awesomeForPage();

  // Opening a week is the moment to bring it into step with the rotation and
  // with any invoice raised inside it. Closed weeks are left exactly as they
  // were: that is what closing means.
  await syncWeek(org.id, id);

  const [detail, clients, standing] = await Promise.all([
    getWeekDetail(org.id, id),
    listClients(org.id),
    listExpenseItems(org.id),
  ]);
  if (!detail) notFound();

  return (
    <WeekView
      detail={detail}
      clients={clients.filter((c) => c.is_active)}
      standing={standing}
      today={todayInSydney()}
    />
  );
}

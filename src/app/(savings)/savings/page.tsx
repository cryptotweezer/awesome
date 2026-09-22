import { redirect } from "next/navigation";

/** The section opens on how the plan is going, which is what it is for. */
export default function SavingsIndex() {
  redirect("/savings/overview");
}

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExpenseCategory, ExpenseItem } from "@/lib/types";

/**
 * The standing weekly costs a savings week starts from.
 *
 * Every query here carries `org_id`, which the caller never supplies: it comes
 * from the session or from an agent's key. That is the only thing keeping one
 * business's data away from another's, so it is not optional and a test walks
 * this file to prove it.
 */
export async function listExpenseItems(
  orgId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<ExpenseItem[]> {
  const supabase = createAdminClient();
  let query = supabase.from("expense_items").select("*").eq("org_id", orgId);
  if (opts.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query
    .order("category")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(`Failed to load expenses: ${error.message}`);
  // numeric comes back as a string; the whole point of this list is arithmetic.
  return (data ?? []).map((r) => ({
    ...r,
    weekly_amount: Number(r.weekly_amount),
  })) as ExpenseItem[];
}

export type ExpenseItemInput = {
  name: string;
  weekly_amount: number;
  category: ExpenseCategory;
};

export async function createExpenseItem(
  orgId: string,
  input: ExpenseItemInput,
): Promise<ExpenseItem> {
  const supabase = createAdminClient();
  // New items go to the end of their own category rather than jumping into the
  // middle of an order somebody arranged on purpose.
  const { data: last } = await supabase
    .from("expense_items")
    .select("sort_order")
    .eq("org_id", orgId)
    .eq("category", input.category)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("expense_items")
    .insert({
      ...input,
      org_id: orgId,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to add expense: ${error.message}`);
  return { ...data, weekly_amount: Number(data.weekly_amount) } as ExpenseItem;
}

export type ExpenseItemPatch = Partial<ExpenseItemInput> & {
  is_active?: boolean;
};

export async function updateExpenseItem(
  orgId: string,
  id: string,
  input: ExpenseItemPatch,
): Promise<ExpenseItem> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("expense_items")
    .update(input)
    .eq("org_id", orgId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update expense: ${error.message}`);
  return { ...data, weekly_amount: Number(data.weekly_amount) } as ExpenseItem;
}

/**
 * Delete an expense outright.
 *
 * Safe today because nothing references one. Once real weeks exist, a closed
 * week will hold its own copy of what it spent, so deleting an item will still
 * not rewrite history: the same reasoning that lets an invoice keep the rate it
 * was raised under.
 */
export async function deleteExpenseItem(
  orgId: string,
  id: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("expense_items")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(`Failed to delete expense: ${error.message}`);
}

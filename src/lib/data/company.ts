import "server-only";
import { getOrg } from "@/lib/data/org";
import type { CompanyProfile, Org } from "@/lib/types";

/**
 * The printed identity of one organisation.
 *
 * This used to read a single `company_profile` row (id = 1). That table is gone
 * and the same fields now live on the org. The `CompanyProfile` shape survives
 * only because the PDF components speak it; F2.3 replaces it with `Org` when
 * per-org logos land.
 */

export function companyProfileFromOrg(org: Org): CompanyProfile {
  return {
    business_name: org.name,
    address_line: org.address_line ?? "",
    suburb: org.suburb ?? "",
    state: org.state ?? "",
    postcode: org.postcode ?? "",
    email: org.email ?? "",
    phone: org.phone ?? "",
    bank_name: org.bank_name ?? "",
    bank_bsb: org.bank_bsb ?? "",
    bank_account_no: org.bank_account_no ?? "",
    bank_account_name: org.bank_account_name ?? "",
    payment_note: org.payment_note ?? "",
    email_subject_template: org.email_subject_template,
    email_body_template: org.email_body_template,
    statement_subject_template: org.statement_subject_template,
    statement_body_template: org.statement_body_template,
  };
}

export async function getCompanyProfile(orgId: string): Promise<CompanyProfile> {
  const org = await getOrg(orgId);
  if (!org) throw new Error(`Organisation ${orgId} not found`);
  return companyProfileFromOrg(org);
}

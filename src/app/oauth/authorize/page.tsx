import Image from "next/image";
import Link from "next/link";
import { getCurrentOrg } from "@/lib/data/org";
import { getClient } from "@/lib/oauth/store";
import { ALL_SCOPES, parseScopes, SCOPE_LABELS, type Scope } from "@/lib/gateway/scopes";
import { approveAuthorization, denyAuthorization } from "./actions";

export const metadata = { title: "Connect an assistant" };

/**
 * The consent screen. An assistant sent somebody here, and this is where the
 * person decides.
 *
 * It is the whole product surface of OAuth, so it says three things plainly:
 * which assistant is asking, which business it will act on, and exactly what it
 * will be able to do. Nothing is pre-approved beyond the safe default, and the
 * destructive permission is off unless the person turns it on deliberately.
 *
 * The trust decision lives here and nowhere else. Registration is open, so a
 * client having a name proves nothing; a person reading that name is the only
 * check that matters.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const clientId = one("client_id");
  const redirectUri = one("redirect_uri");
  const responseType = one("response_type");
  const challenge = one("code_challenge");
  const method = one("code_challenge_method");
  const state = one("state") ?? "";
  const requested = parseScopes(one("scope"));

  const ctx = await getCurrentOrg();
  if (!ctx) {
    return (
      <Problem
        title="Sign in first"
        detail="You need to be signed in to this business before you can connect an assistant to it."
        action={{ href: "/login", label: "Go to sign in" }}
      />
    );
  }
  if (!ctx.org) {
    return (
      <Problem
        title="No business yet"
        detail="Set up your business before connecting an assistant, so there is something for it to work on."
        action={{ href: "/", label: "Open the dashboard" }}
      />
    );
  }

  const client = clientId ? await getClient(clientId) : null;

  // A bad client or a redirect we never registered must NOT be redirected to:
  // sending an error to an address we do not trust is how a stolen code ends
  // up somewhere it should not. Show it here instead.
  if (!client) {
    return (
      <Problem
        title="Unknown assistant"
        detail="This connection request did not come from an assistant registered with this app. Nothing was authorised. Try connecting again from the assistant itself."
      />
    );
  }
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return (
      <Problem
        title="That return address is not registered"
        detail={`${client.client_name} asked to be sent back somewhere it did not register. Nothing was authorised.`}
      />
    );
  }
  if (responseType !== "code" || !challenge || method !== "S256") {
    return (
      <Problem
        title="This request is missing its protection"
        detail="A connection request has to use an authorization code with PKCE. Nothing was authorised. If you built this client yourself, that is the part to fix."
      />
    );
  }

  // Asking for nothing in particular gets the safe default rather than
  // everything: an assistant should have to name the power it wants.
  const wanted: Scope[] = requested.length > 0 ? requested : ["read"];
  const business = ctx.org.display_name || ctx.org.name;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <div className="rounded-2xl bg-white p-7 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex items-center gap-3">
          <Image
            src="/logo_ah_black.png"
            alt=""
            width={28}
            height={28}
            className="dark:hidden"
          />
          <Image
            src="/logo_ah_white.png"
            alt=""
            width={28}
            height={28}
            className="hidden dark:block"
          />
          <span className="text-sm font-semibold tracking-tight">
            AI Billing Service
          </span>
        </div>

        <h1 className="mt-6 text-xl font-bold leading-snug tracking-tight">
          <span className="text-sky-600 dark:text-sky-400">
            {client.client_name}
          </span>{" "}
          wants to work on {business}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          It will act as you, {ctx.member.display_name || ctx.member.email}, and
          only on this business. Anything it creates or changes is recorded
          against its name.
        </p>

        <form action={approveAuthorization} className="mt-6">
          <input type="hidden" name="client_id" value={client.client_id} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={challenge} />
          <input type="hidden" name="state" value={state} />

          <fieldset className="space-y-3">
            <legend className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              What it will be able to do
            </legend>
            {ALL_SCOPES.map((scope) => {
              const asked = wanted.includes(scope);
              return (
                <label
                  key={scope}
                  className="flex cursor-pointer gap-3 rounded-xl p-3 ring-1 ring-slate-200 transition hover:bg-slate-50 dark:ring-slate-800 dark:hover:bg-slate-800/50"
                >
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    defaultChecked={asked}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-sky-600"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {SCOPE_LABELS[scope].title}
                      {!asked && (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          not requested
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {SCOPE_LABELS[scope].detail}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            You can untick anything you would rather it could not do, and change
            your mind later: this connection can be cut off at any time from
            Agent keys, without touching any other assistant.
          </p>

          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Authorise
            </button>
            <button
              type="submit"
              formAction={denyAuthorization}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        Did not expect this? Close the page. Nothing is connected until you
        authorise it.
      </p>
    </main>
  );
}

function Problem({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { href: string; label: string };
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <div className="rounded-2xl bg-white p-7 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h1 className="text-lg font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {detail}
        </p>
        {action && (
          <Link
            href={action.href}
            className="mt-5 inline-block rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {action.label}
          </Link>
        )}
      </div>
    </main>
  );
}

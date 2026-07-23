import { LoginButton } from "./login-button";

const MESSAGES: Record<string, string> = {
  unauthorized:
    "That Google account is not authorised for Awesome Cleaning billing.",
  auth: "Something went wrong while signing in. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? MESSAGES[error] : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Awesome Cleaning
          </h1>
          <p className="mt-1 text-sm text-slate-500">Billing dashboard</p>
        </div>

        {message && (
          <div className="mb-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
            {message}
          </div>
        )}

        <LoginButton />

        <p className="mt-6 text-center text-xs text-slate-400">
          Access is restricted to authorised accounts only.
        </p>
      </div>
    </main>
  );
}

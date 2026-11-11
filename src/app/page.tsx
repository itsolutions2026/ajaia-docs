import { redirect } from "next/navigation";

import LoginForm from "@/components/login-form";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    // Database unavailable: still show the landing page.
  }
  if (user) redirect("/documents");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Ajaia Docs</h1>
        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
          Your documents, organized in one place.
        </p>

        <section
          aria-labelledby="signin-heading"
          className="mt-10 rounded-xl border border-zinc-200 bg-white p-6 text-left shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 id="signin-heading" className="text-base font-medium">
            Sign in
          </h2>
          <LoginForm />
          <div className="mt-5 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <p className="font-medium">Demo accounts</p>
            <ul className="mt-1 space-y-1">
              <li>alice@demo.ajaia.example · Alice-Demo-2026 (owner)</li>
              <li>bob@demo.ajaia.example · Bob-Demo-2026 (editor on Alice&apos;s doc)</li>
              <li>carol@demo.ajaia.example · Carol-Demo-2026 (no access)</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}

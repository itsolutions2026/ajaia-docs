"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Service temporarily unavailable</h1>
      <p className="mt-2 max-w-md text-zinc-600 dark:text-zinc-400">
        We couldn&apos;t reach the database. If this persists, the free-tier database may be paused after
        inactivity. Please try again shortly.
      </p>
      <button type="button" onClick={reset} className="mt-6 text-sm font-medium underline">
        Try again
      </button>
    </main>
  );
}

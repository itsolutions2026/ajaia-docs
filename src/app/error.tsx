"use client";

// `retry` (stable since Next 16.3) re-fetches the failed server content;
// `reset` would only re-render the same failed payload.
export default function ErrorPage({ retry }: { error: Error; retry: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-md text-zinc-600 dark:text-zinc-400">
        The page couldn&apos;t be loaded. Please try again. If the problem continues, the service may be
        temporarily unavailable (for example, the free-tier database pauses after a period of inactivity).
      </p>
      <button type="button" onClick={() => retry()} className="mt-6 text-sm font-medium underline">
        Try again
      </button>
    </main>
  );
}

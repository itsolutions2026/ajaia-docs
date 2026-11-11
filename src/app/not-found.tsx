import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        This page or document doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/documents" className="mt-6 text-sm font-medium underline">
        Back to your documents
      </Link>
    </main>
  );
}

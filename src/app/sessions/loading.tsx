import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <Skeleton className="h-8 w-32" />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[380px_1fr] lg:items-start">
        <Skeleton className="h-[420px] w-full" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-11 w-full" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-11 w-full lg:w-64" />
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
        <Skeleton className="h-48 w-full" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

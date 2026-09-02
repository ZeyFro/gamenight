import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-8 sm:pb-12">
      <Skeleton className="h-40 w-full sm:h-56 md:h-64" />
      <div className="flex flex-col gap-4 px-4 sm:px-6">
        <div className="-mt-16 flex items-end gap-4 sm:-mt-20">
          <Skeleton className="h-24 w-24 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pb-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-2 w-full" />
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

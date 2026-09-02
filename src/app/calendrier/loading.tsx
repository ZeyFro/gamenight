import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-5xl">
      <Skeleton className="h-8 w-48" />
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[320px_1fr] lg:items-start lg:gap-6">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
        <Skeleton className="h-[500px] w-full" />
      </div>
    </div>
  );
}

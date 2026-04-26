import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SkeletonVariant = "session" | "debt" | "stat" | "row";

interface SkeletonCardProps {
  variant: SkeletonVariant;
  className?: string;
}

/**
 * Pre-sized skeleton blocks that match real content layouts so loading
 * states don't shift the page when data arrives.
 */
export function SkeletonCard({ variant, className }: SkeletonCardProps) {
  if (variant === "stat") {
    return (
      <div
        className={cn(
          "border-border bg-card flex items-center gap-3 rounded-2xl border p-4",
          className,
        )}
      >
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-28" />
        </div>
      </div>
    );
  }
  if (variant === "row") {
    return (
      <div
        className={cn(
          "border-border bg-card flex items-center gap-3 rounded-xl border px-3 py-3",
          className,
        )}
      >
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-7 w-16 rounded-full" />
      </div>
    );
  }
  // session / debt — vertical card
  return (
    <div
      className={cn(
        "border-border bg-card space-y-3 rounded-2xl border p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-2 pt-2">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
      </div>
    </div>
  );
}

interface SkeletonListProps {
  variant: SkeletonVariant;
  count?: number;
  className?: string;
}

export function SkeletonList({
  variant,
  count = 3,
  className,
}: SkeletonListProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} variant={variant} />
      ))}
    </div>
  );
}

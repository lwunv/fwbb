import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        amber:
          "border border-amber-500/45 bg-amber-400 text-amber-950 shadow-sm [a]:hover:bg-amber-400/85 dark:border-amber-400/50 dark:bg-amber-500 dark:text-amber-950 dark:[a]:hover:bg-amber-500/90",
        /** Cùng tông khối vote “Tăng 1 - Cầu lông” */
        votePlay:
          "border border-primary/45 bg-primary/[0.1] text-primary shadow-sm ring-1 ring-primary/20 dark:bg-primary/12 dark:ring-primary/25 [a]:hover:bg-primary/[0.16]",
        /** Cùng tông khối vote “Tăng 2 - Nhậu” (orange, không phải amber) */
        voteDine:
          "border border-orange-500/55 bg-orange-500/[0.1] text-orange-700 shadow-sm ring-1 ring-orange-500/20 dark:border-orange-500/45 dark:bg-orange-950/30 dark:text-orange-400 dark:ring-orange-500/25 [a]:hover:bg-orange-500/[0.14] dark:[a]:hover:bg-orange-950/45",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }

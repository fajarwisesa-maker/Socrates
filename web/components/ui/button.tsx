// shadcn/ui-style Button (copied pattern, owned here; the shadcn registry is not reachable
// from the build container, so primitives are written in the same shape by hand).
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-[0.5em] whitespace-nowrap font-semibold transition-colors outline-none focus-visible:ring-4 focus-visible:ring-brand/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        brand: "bg-brand text-white hover:bg-brand-ink",
        approve: "bg-ok-ink text-white hover:bg-[#14532d]",
        outline: "border-2 border-line bg-surface text-ink hover:bg-surface-2",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        danger: "border-2 border-risk-ink bg-surface text-risk-ink hover:bg-risk-soft",
      },
      size: {
        sm: "h-8 rounded-[10px] px-3 text-sm",
        md: "h-10 rounded-[var(--radius-control)] px-4 text-base",
        lg: "h-12 rounded-[var(--radius-control)] px-5 text-lg",
        xl: "h-16 rounded-[var(--radius-card)] px-8 text-2xl",
      },
    },
    defaultVariants: { variant: "brand", size: "md" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };

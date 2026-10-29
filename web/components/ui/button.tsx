// shadcn/ui-style Button (copied pattern, owned here; the shadcn registry is not reachable
// from the build container, so primitives are written in the same shape by hand).
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-[0.5em] whitespace-nowrap font-extrabold",
    // hover 200ms, press 120ms (active), colours and shadow only: no scaling
    "transition-[background-color,color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-standard)] active:duration-[var(--dur-press)]",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // primary: filled green (yellow on dark); secondary: a 2px asphalt hairline;
        // tertiary (`link`): underlined text
        brand: "bg-sign-green text-white hover:bg-brand-ink active:bg-[#003d22]",
        approve: "bg-sign-green text-white hover:bg-brand-ink active:bg-[#003d22]",
        outline: "bg-transparent text-asphalt inset-ring-2 inset-ring-asphalt hover:bg-asphalt/8 active:bg-asphalt/15",
        ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
        danger: "bg-road-white text-risk-ink inset-ring-2 inset-ring-stop-red hover:bg-risk-soft",
        stop: "bg-stop-red text-white hover:bg-risk-ink active:bg-[#6f0818]",
        link: "h-auto rounded-[4px] px-0 font-bold text-asphalt underline decoration-2 underline-offset-4 hover:decoration-sign-green",
      },
      size: {
        sm: "h-9 rounded-[8px] px-3 text-sm",
        md: "h-11 rounded-[var(--radius-control)] px-4 text-base",
        lg: "h-12 rounded-[var(--radius-control)] px-5 text-xl",
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
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size: variant === "link" ? null : size, className }))} {...props} />;
}

export { Button, buttonVariants };

// shadcn/ui-style Switch on the Radix primitive.
"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.5em] w-[2.6em] shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-4 focus-visible:ring-brand/30 data-[state=checked]:bg-brand data-[state=unchecked]:bg-[#94a3b8]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[1.15em] rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[1.1em] data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };

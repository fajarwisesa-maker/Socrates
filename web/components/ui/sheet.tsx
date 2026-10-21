// shadcn/ui-style Sheet (right-side drawer) on the Radix Dialog primitive.
"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;

export function SheetContent({ className, children, ...props }: React.ComponentProps<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
      <Dialog.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(44rem,92vw)] flex-col bg-surface shadow-[-8px_0_32px_rgb(15_23_42/0.18)] outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close
          className="absolute top-4 right-4 rounded-full p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
          aria-label="Close details"
        >
          <X className="size-5" />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

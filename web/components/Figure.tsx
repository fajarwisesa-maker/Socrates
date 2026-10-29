/**
 * A counting figure that never changes the layout: the final string sets the width, the
 * counting string is drawn over it, right-aligned.
 */
export function Figure({ shown, final }: { shown: string; final: string }) {
  return (
    <span className="relative inline-block">
      <span className="invisible" aria-hidden>
        {final}
      </span>
      <span className="absolute top-0 right-0 whitespace-nowrap">{shown}</span>
    </span>
  );
}

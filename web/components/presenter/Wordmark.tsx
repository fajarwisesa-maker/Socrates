import { Logo } from "../signs";

/** The siaga wordmark on an asphalt chip (the white logo needs a dark surface). */
export function Wordmark() {
  return (
    <span className="inline-flex items-center rounded-[8px] bg-asphalt px-3 py-2">
      <Logo height={24} />
    </span>
  );
}

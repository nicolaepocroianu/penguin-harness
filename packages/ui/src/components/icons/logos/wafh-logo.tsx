/**
 * The brand logo (five coloured points joined into a W on a dark rounded tile). The asset is the
 * app's — it also serves as the favicon — so the caller passes its URL. The tile carries its own
 * rounded corners and reads the same in light and dark mode; `className` controls size and
 * cropping. Purely decorative, hidden from screen readers.
 */
export function WafHarnessLogo({ src, className }: { src: string; className?: string }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={`select-none ${className ?? "h-9 w-9 rounded-lg"}`}
    />
  );
}

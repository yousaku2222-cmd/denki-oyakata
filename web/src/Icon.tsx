/** The path of a drawn icon (web/public/icons, cut from the icon sheets the author made for this app). */
export const ic = (name: string) => `/icons/${name}.webp`;

/** A drawn icon when `of` is a path (see ic), otherwise the emoji as it is. */
export function Icon({ of, className = "" }: { of: string; className?: string }) {
  return of.startsWith("/") ? (
    <img className={`icon ${className}`} src={of} alt="" aria-hidden />
  ) : (
    <span className={className} aria-hidden>
      {of}
    </span>
  );
}

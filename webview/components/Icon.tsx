const PATHS: Record<string, string> = {
  user: "M8 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 14a5.5 5.5 0 0 1 11 0H2.5Z",
  spark: "M8 0l1.5 4.5L14 6l-4.5 1.5L8 12l-1.5-4.5L2 6l4.5-1.5L8 0z",
  check: "M13.5 4.5L6 12l-3.5-3.5 1-1L6 10l6.5-6.5 1 1z",
  x: "M8 6.6 12.2 2.4l1.4 1.4L9.4 8l4.2 4.2-1.4 1.4L8 9.4l-4.2 4.2-1.4-1.4L6.6 8 2.4 3.8l1.4-1.4L8 6.6z",
  chevron: "M5.5 4L10 8l-4.5 4-1-1L7.5 8 4.5 5l1-1z",
  term: "M2 2h12v12H2V2zm1 1v10h10V3H3zm1.5 2 2.5 3-2.5 3H5l2.2-2.6V7.6L5 5h-.5zm4 5h3v1h-3v-1z",
  edit: "M11.5 2.5l2 2L5 13H3v-2l8.5-8.5zm-1 1L4 10v2h2l6.5-6.5-1-1z",
};

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" className="icon" aria-hidden>
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

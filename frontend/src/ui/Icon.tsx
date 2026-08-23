/**
 * Ícones em SVG inline.
 *
 * Emoji dependem da fonte do sistema: no Windows saem coloridos e grandes
 * demais, e o alinhamento muda de um para outro. Estes herdam `currentColor` e
 * o tamanho do texto, então acompanham o estado do botão (hover, disabled).
 */
export type IconName =
  | "upload" | "play" | "stop" | "trash" | "copy" | "edit" | "eye" | "eye-off"
  | "retry" | "download" | "check" | "alert" | "info" | "close" | "layers"
  | "film" | "folder" | "plus" | "grid" | "refresh" | "select-all"
  | "chevron-right" | "chevron-down" | "search" | "bell" | "crop" | "home"
  | "sparkles" | "settings" | "logout" | "sliders" | "zap" | "clock";

const PATHS: Record<IconName, React.ReactNode> = {
  upload:      <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /></>,
  play:        <path d="M7 4.5v15l12-7.5z" />,
  stop:        <rect x="6" y="6" width="12" height="12" rx="2.5" />,
  trash:       <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" /></>,
  copy:        <><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 5H6a1 1 0 0 0-1 1v9" /></>,
  edit:        <><path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z" /><path d="M15 6l3 3" /></>,
  eye:         <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="3" /></>,
  "eye-off":   <><path d="M4 4l16 16" /><path d="M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 6 10 6a17 17 0 0 1-3.3 3.9" /><path d="M6.2 7.4C3.7 9 2 11 2 11s3.5 6 10 6c1.4 0 2.6-.3 3.7-.7" /></>,
  retry:       <><path d="M3 12a9 9 0 1 1 3 6.7" /><path d="M3 20v-5h5" /></>,
  download:    <><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>,
  check:       <path d="m5 13 4 4L19 7" />,
  alert:       <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  info:        <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  close:       <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
  layers:      <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 14 9 5 9-5" /></>,
  film:        <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M8 4v16" /><path d="M16 4v16" /><path d="M3 12h18" /></>,
  folder:      <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  plus:        <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  grid:        <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  refresh:     <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
  "select-all": <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="m8 12 3 3 5-6" /></>,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  "chevron-down":  <path d="m6 9 6 6 6-6" />,
  search:      <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  bell:        <><path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 3h15z" /><path d="M10 21h4" /></>,
  crop:        <><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M2 6h14a2 2 0 0 1 2 2v14" /></>,
  home:        <><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 21v-7h6v7" /></>,
  sparkles:    <><path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18 16.5 18.8 19l2.2.8-2.2.8L18 23l-.8-2.4-2.2-.8 2.2-.8z" /></>,
  settings:    <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.5 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  logout:      <><path d="M10 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" /><path d="m16 16 4-4-4-4" /><path d="M20 12H10" /></>,
  sliders:     <><path d="M4 8h10" /><path d="M18 8h2" /><path d="M4 16h4" /><path d="M12 16h8" /><circle cx="16" cy="8" r="2" /><circle cx="10" cy="16" r="2" /></>,
  zap:         <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  clock:       <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
};

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

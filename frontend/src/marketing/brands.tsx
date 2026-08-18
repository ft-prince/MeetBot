import type { Integration } from './content'

/**
 * Brand marks for the integrations we actually connect to.
 *
 * These are hand-built, brand-coloured reconstructions — recognisable at
 * 20–32px, but NOT the vendors' official artwork. Before launch, download each
 * logo from its owner's brand page (Google Workspace, Zoom, Microsoft) and
 * replace the paths here; every brand's guidelines require their own file, and
 * several forbid redrawing the mark.
 *
 * ponytail: one file, one component, swapped by slug. Replacing these with real
 * assets later is a paste job, not a refactor.
 */

function GoogleMeet({ size }: { size: number }) {
  // Camera silhouette: blue body, green lens wedge, red/yellow corner accents.
  // Kept blocky on purpose — the real mark's thin facets disappear below 24px.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6.5" width="11.5" height="11" rx="1.6" fill="#0066DA" />
      <path fill="#E94235" d="M14.5 6.5h-4l4 4z" />
      <path fill="#FFBA00" d="M3 13.5v2.4c0 .88.72 1.6 1.6 1.6H7z" />
      <path fill="#00AC47" d="M14.5 9.4 19.4 6.6c.73-.42 1.6.11 1.6.9v9c0 .79-.87 1.32-1.6.9l-4.9-2.8z" />
      <path fill="#00832D" d="M14.5 9.4v5.2l-2.6-2.6z" opacity=".55" />
    </svg>
  )
}

function Zoom({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="5.4" fill="#0B5CFF" />
      <path
        fill="#fff"
        d="M6 9.6c0-.66.54-1.2 1.2-1.2h5.4c.99 0 1.8.81 1.8 1.8v4.2c0 .66-.54 1.2-1.2 1.2H7.8A1.8 1.8 0 0 1 6 13.8zm9.6 2.02 2.3-1.72c.4-.3.96-.02.96.48v3.24c0 .5-.57.78-.96.48l-2.3-1.72z"
      />
    </svg>
  )
}

function MicrosoftTeams({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="5.5" width="12.5" height="13" rx="1.6" fill="#5059C9" />
      <path fill="#fff" d="M4.4 8.6h7.7v1.7H9.2v6H7.3v-6H4.4z" />
      <circle cx="18.4" cy="7.2" r="2.4" fill="#7B83EB" />
      <path fill="#7B83EB" d="M15.4 11h5.4a1.2 1.2 0 0 1 1.2 1.2v3.4a3.6 3.6 0 0 1-3.6 3.6h-.2a3.6 3.6 0 0 1-2.8-1.35z" opacity=".9" />
    </svg>
  )
}

function GoogleCalendar({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2.4" fill="#fff" stroke="#DADCE0" />
      <path fill="#4285F4" d="M3 5.4A2.4 2.4 0 0 1 5.4 3H18v3H3z" />
      <path fill="#EA4335" d="M18 3h.6A2.4 2.4 0 0 1 21 5.4V6h-3z" />
      <path fill="#34A853" d="M18 18h3v.6a2.4 2.4 0 0 1-2.4 2.4H18z" />
      <path fill="#FBBC04" d="M3 18h3v3h-.6A2.4 2.4 0 0 1 3 18.6z" />
      <text x="12" y="16.4" textAnchor="middle" fontSize="7.5" fontWeight="600" fill="#4285F4" fontFamily="Inter, sans-serif">
        31
      </text>
    </svg>
  )
}

function Gmail({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#fff" d="M3.6 6h16.8v12H3.6z" />
      <path fill="#EA4335" d="M3.6 6.9c0-.9.98-1.4 1.68-.86L12 11.3l-8.4 6.3z" />
      <path fill="#FBBC04" d="M3.6 17.6 12 11.3v6.3H5.1a1.5 1.5 0 0 1-1.5-1.5z" opacity=".9" />
      <path fill="#34A853" d="M20.4 17.6V6.9L12 11.3v6.3h6.9a1.5 1.5 0 0 0 1.5-1.5z" />
      <path fill="#4285F4" d="M20.4 6.9V17.6L12 11.3l6.72-5.26c.7-.54 1.68-.04 1.68.86z" />
      <path fill="#C5221F" d="M3.6 6.9v2.2L12 15.4l8.4-6.3V6.9L12 13.2z" opacity=".25" />
    </svg>
  )
}

const MARKS: Record<Integration['slug'], (p: { size: number }) => JSX.Element> = {
  'google-meet': GoogleMeet,
  zoom: Zoom,
  'microsoft-teams': MicrosoftTeams,
  'google-calendar': GoogleCalendar,
  gmail: Gmail,
}

export function BrandMark({ slug, size = 24 }: { slug: string; size?: number }) {
  const Mark = MARKS[slug]
  if (!Mark) return null
  return <Mark size={size} />
}

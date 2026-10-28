/**
 * Connect needs the dev/preview server's /api/introspect proxy. Static hosting (GitHub Pages)
 * builds with VITE_STATIC_HOST set and has no server, so the feature is hidden there.
 */
export const CAN_CONNECT = !import.meta.env.VITE_STATIC_HOST;

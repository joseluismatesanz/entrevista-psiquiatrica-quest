// El backend V0.4 se activa automáticamente solo en despliegues de prueba Vercel.
// En GitHub Pages o al abrir el prototipo localmente, se mantiene el motor local.
window.CLINICAL_API_URL = window.location.hostname.endsWith(".vercel.app")
  ? window.location.origin
  : "";

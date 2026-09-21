import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';

export default function Attribution() {
  const t = useT();
  const mode = useStore((s) => s.mode);
  const basemap = useStore((s) => s.basemap);
  const radar = useStore((s) => s.layers.radar);
  const tiles =
    mode === '2d'
      ? basemap === 'satellite'
        ? 'Imagery © Esri, Maxar, Earthstar Geographics'
        : '© OpenStreetMap contributors © CARTO'
      : 'Imagery: NASA Blue Marble / Black Marble';
  return (
    <footer className="attribution" dir="ltr">
      <span>{tiles}</span>
      {mode === '2d' && radar && <span> · Radar © RainViewer</span>}
      <span className="attr-long"> · {t('attrib.all')}</span>
    </footer>
  );
}

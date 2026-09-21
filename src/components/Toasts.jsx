import { useStore } from '../store/useStore.js';
import { useT } from '../i18n/index.js';
import { Icon } from './Icons.jsx';

const GLYPH = { ok: '✓', warn: '!', error: '×', info: 'i' };

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const t = useT();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast glass tone-${toast.tone}`}>
          <span className="toast-glyph">{GLYPH[toast.tone] || 'i'}</span>
          <p>{toast.messageKey ? t(toast.messageKey) : toast.message}</p>
          <button className="icon-btn ghost" onClick={() => dismiss(toast.id)} aria-label={t('details.close')}>
            <Icon.close width={14} height={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

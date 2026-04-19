import { Check, X, Loader2, AlertTriangle, Clock } from 'lucide-react';

const CONFIDENCE_CONFIG = {
  high: { className: 'badge--success', label: 'Visoka' },
  medium: { className: 'badge--warning', label: 'Srednja' },
  low: { className: 'badge--error', label: 'Niska' },
};

const FILE_STATUS_CONFIG = {
  queued: { className: 'badge--neutral', label: 'Na cekanju', icon: Clock },
  processing: { className: 'badge--accent badge--pulse', label: 'Obrada...', icon: Loader2 },
  done: { className: 'badge--success', label: 'Zavrseno', icon: Check },
  failed: { className: 'badge--error', label: 'Greska', icon: X },
};

export default function StatusBadge({ type = 'confidence', status, confidence }) {
  if (type === 'file') {
    const config = FILE_STATUS_CONFIG[status] || FILE_STATUS_CONFIG.queued;
    const Icon = config.icon;
    return (
      <span className={`badge ${config.className}`}>
        <Icon size={12} />
        <span>{config.label}</span>
      </span>
    );
  }

  // Confidence badge
  const conf = confidence || status;
  const config = CONFIDENCE_CONFIG[conf] || CONFIDENCE_CONFIG.high;
  return (
    <span className={`badge ${config.className}`}>
      {conf === 'low' && <AlertTriangle size={12} />}
      {conf === 'medium' && <AlertTriangle size={12} />}
      <span>{config.label}</span>
    </span>
  );
}

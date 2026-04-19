import { FileText, X } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateName(name, maxLen = 40) {
  if (name.length <= maxLen) return name;
  const ext = name.lastIndexOf('.');
  if (ext === -1) return name.slice(0, maxLen - 3) + '...';
  const extension = name.slice(ext);
  const baseName = name.slice(0, ext);
  const available = maxLen - extension.length - 3;
  return baseName.slice(0, Math.max(available, 10)) + '...' + extension;
}

export default function FileListItem({ file, index, onRemove, status }) {
  const tooLarge = file.size > 20 * 1024 * 1024;

  return (
    <div className={`file-list-item ${tooLarge ? 'file-list-item--error' : ''}`}>
      <FileText size={16} className="file-list-item-icon" />
      <span className="file-list-item-name" title={file.name}>
        {truncateName(file.name)}
      </span>
      <span className="file-list-item-size">{formatSize(file.size)}</span>
      {status && <StatusBadge type="file" status={status} />}
      {tooLarge && (
        <span className="file-list-item-error">Fajl prevelik (maks. 20MB)</span>
      )}
      {onRemove && (
        <button
          className="file-list-item-remove"
          onClick={() => onRemove(index)}
          type="button"
          aria-label="Ukloni fajl"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

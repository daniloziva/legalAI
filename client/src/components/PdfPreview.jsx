import { useState, useCallback, useEffect, useRef } from 'react';
import { X, AlertTriangle, CheckCircle, Pencil } from 'lucide-react';
import { FIELD_KEYS, FIELD_LABELS, truncateName } from '../constants.js';

function PreviewField({ label, field, fieldKey, onUpdate }) {
  const [editValue, setEditValue] = useState(field?.value || '');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  // Sync editValue when prop changes externally (e.g., edit from ResultsTable)
  useEffect(() => {
    if (!focused) setEditValue(field?.value || '');
  }, [field?.value, focused]);

  const isLow = field?.confidence === 'low';
  const isMedium = field?.confidence === 'medium';
  const isHigh = field?.confidence === 'high';
  const isEmpty = !field?.value;

  // Determine confidence tier for styling
  const confidenceTier = isEmpty ? 'empty' : isLow ? 'low' : isMedium ? 'medium' : 'high';

  const handleFocus = useCallback(() => {
    setFocused(true);
  }, []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    if (editValue !== (field?.value || '')) {
      onUpdate(fieldKey, editValue);
    }
  }, [editValue, field, fieldKey, onUpdate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') {
      setEditValue(field?.value || '');
      inputRef.current?.blur();
    }
  }, [field]);

  const fieldClass = [
    'preview-field',
    `preview-field--${confidenceTier}`,
    focused ? 'preview-field--focused' : '',
  ].filter(Boolean).join(' ');

  const confidenceBadgeClass = [
    'preview-field-confidence',
    `preview-field-confidence--${confidenceTier}`,
  ].join(' ');

  const confidenceLabel =
    isEmpty ? 'Nedostaje' : isLow ? 'Niska' : isMedium ? 'Srednja' : 'Visoka';

  return (
    <div className={fieldClass}>
      <div className="preview-field-header">
        <span className="preview-field-label">
          {label}
        </span>
        <span className={confidenceBadgeClass}>
          {(isLow || isEmpty) && <AlertTriangle size={10} />}
          {isMedium && <AlertTriangle size={10} />}
          {isHigh && !isEmpty && <CheckCircle size={10} />}
          {confidenceLabel}
        </span>
      </div>
      <div className="preview-field-input-wrap">
        <input
          ref={inputRef}
          className="preview-field-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={isEmpty ? 'Kliknite da unesete vrednost...' : ''}
        />
        {!focused && <Pencil size={12} className="preview-field-edit-icon" />}
      </div>
    </div>
  );
}

export default function PdfPreview({ filename, pdfUrl, fields, onClose, onUpdateField }) {
  // Close on backdrop click
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="preview-overlay" onClick={handleBackdropClick}>
      <div className="preview-modal">
        {/* Header */}
        <div className="preview-modal-header">
          <span className="pdf-preview-filename" title={filename}>
            {truncateName(filename, 60)}
          </span>
          <button
            className="pdf-preview-close"
            onClick={onClose}
            type="button"
            aria-label="Zatvori pregled"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body: fields left, PDF right */}
        <div className="preview-modal-body">
          {/* Left column: extracted fields stacked vertically */}
          <div className="preview-modal-fields">
            <h3 className="preview-modal-fields-title">Ekstraktovani podaci</h3>
            {fields && FIELD_KEYS.map(key => (
              <PreviewField
                key={key}
                label={FIELD_LABELS[key]}
                field={fields[key]}
                fieldKey={key}
                onUpdate={onUpdateField}
              />
            ))}
            {!fields && (
              <p className="preview-modal-no-data">Nema podataka za prikaz</p>
            )}
          </div>

          {/* Right column: PDF viewer */}
          <div className="preview-modal-viewer">
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                className="pdf-preview-iframe"
                title="PDF pregled"
              />
            ) : (
              <div className="pdf-preview-fallback">
                <p>PDF pregled nije dostupan</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

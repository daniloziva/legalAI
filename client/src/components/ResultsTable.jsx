import { useState, useCallback, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { FIELD_KEYS, FIELD_LABELS, truncateName } from '../constants.js';

function getRowStatus(result) {
  if (result.error) return 'error';
  if (result.retrying) return 'processing';
  if (!result.fields) return 'error';
  const hasLow = Object.values(result.fields).some(f => f.confidence === 'low' || !f.value);
  const hasMedium = Object.values(result.fields).some(f => f.confidence === 'medium');
  if (hasLow) return 'low';
  if (hasMedium) return 'medium';
  return 'high';
}

function EditableCell({ value, confidence, flags, fieldKey, rowIndex, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  // Sync editValue when prop changes externally (e.g., edit from PdfPreview)
  useEffect(() => {
    if (!editing) setEditValue(value);
  }, [value, editing]);

  const handleClick = useCallback(() => {
    setEditValue(value);
    setEditing(true);
  }, [value]);

  const handleBlur = useCallback(() => {
    setEditing(false);
    if (editValue !== value) {
      onUpdate(rowIndex, fieldKey, editValue);
    }
  }, [editValue, value, rowIndex, fieldKey, onUpdate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.target.blur();
    }
    if (e.key === 'Escape') {
      setEditValue(value);
      setEditing(false);
    }
  }, [value]);

  const isLow = confidence === 'low';
  const isMedium = confidence === 'medium';
  const isEmpty = !value;
  const isTransliterated = Boolean(flags?.includes('transliterated'));

  const cellClass = [
    'results-cell-field',
    isLow ? 'cell--low' : '',
    isMedium ? 'cell--medium' : '',
    isEmpty ? 'cell--empty' : '',
  ].filter(Boolean).join(' ');

  return (
    <td className={cellClass} onClick={!editing ? handleClick : undefined}>
      {editing ? (
        <input
          className="cell-input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      ) : (
        <div className="cell-display">
          {isTransliterated && (
            <span
              className="cell-translit-badge"
              title="Automatski prevedeno sa ćirilice na latinicu"
            >
              t
            </span>
          )}
          {(isLow || isMedium) && (
            <AlertTriangle
              size={12}
              className={`cell-warning-icon ${isLow ? 'cell-warning-icon--low' : 'cell-warning-icon--medium'}`}
            />
          )}
          <span className={isEmpty ? 'cell-empty-value' : ''}>
            {isEmpty ? '\u2014' : value}
          </span>
        </div>
      )}
    </td>
  );
}

export default function ResultsTable({
  results,
  selectedRow,
  onSelectRow,
  onUpdateField,
  onRetryRow,
}) {
  if (!results || results.length === 0) return null;

  const fieldColSpan = FIELD_KEYS.length;

  return (
    <div className="results-table-wrapper">
      <table className="results-table">
        <thead>
          <tr>
            <th className="col-num">#</th>
            <th className="col-doc">Dokument</th>
            {FIELD_KEYS.map(key => (
              <th key={key}>{FIELD_LABELS[key]}</th>
            ))}
            <th className="col-status">Status</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result, idx) => {
            const isSelected = selectedRow === idx;
            const rowStatus = getRowStatus(result);

            if (result.error) {
              return (
                <tr
                  key={idx}
                  className={`results-row results-row--error ${isSelected ? 'results-row--selected' : ''}`}
                  onClick={() => onSelectRow(idx)}
                >
                  <td className="col-num">{idx + 1}</td>
                  <td className="col-doc" title={result.filename}>
                    {truncateName(result.filename)}
                  </td>
                  <td colSpan={fieldColSpan} className="results-error-cell">
                    <span className="results-error-message">
                      {result.error}
                    </span>
                    <button
                      className="results-retry-link"
                      onClick={(e) => { e.stopPropagation(); onRetryRow(idx); }}
                      type="button"
                    >
                      Pokušaj ponovo
                    </button>
                  </td>
                  <td className="col-status">
                    <StatusBadge type="confidence" confidence="low" />
                  </td>
                </tr>
              );
            }

            if (result.retrying) {
              return (
                <tr key={idx} className="results-row results-row--retrying">
                  <td className="col-num">{idx + 1}</td>
                  <td className="col-doc" title={result.filename}>
                    {truncateName(result.filename)}
                  </td>
                  <td colSpan={fieldColSpan}>
                    <span className="results-retrying-text">Ponovna obrada...</span>
                  </td>
                  <td className="col-status">
                    <StatusBadge type="file" status="processing" />
                  </td>
                </tr>
              );
            }

            return (
              <tr
                key={idx}
                className={`results-row ${isSelected ? 'results-row--selected' : ''}`}
                onClick={() => onSelectRow(idx)}
              >
                <td className="col-num">{idx + 1}</td>
                <td className="col-doc" title={result.filename}>
                  {truncateName(result.filename)}
                </td>
                {FIELD_KEYS.map(fieldKey => {
                  const field = result.fields?.[fieldKey];
                  return (
                    <EditableCell
                      key={fieldKey}
                      value={field?.value || ''}
                      confidence={field?.confidence || 'low'}
                      flags={field?.flags}
                      fieldKey={fieldKey}
                      rowIndex={idx}
                      onUpdate={onUpdateField}
                    />
                  );
                })}
                <td className="col-status">
                  {rowStatus === 'high' && (
                    <StatusBadge type="confidence" confidence="high" />
                  )}
                  {rowStatus === 'medium' && (
                    <StatusBadge type="confidence" confidence="medium" />
                  )}
                  {(rowStatus === 'low') && (
                    <StatusBadge type="confidence" confidence="low" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

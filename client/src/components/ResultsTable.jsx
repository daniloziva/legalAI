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

function getStatusBadgeLabel(status) {
  switch (status) {
    case 'error': return 'Greska';
    case 'processing': return 'Obrada...';
    case 'low': return 'Delimicno';
    case 'medium': return 'Zavrseno';
    case 'high': return 'Zavrseno';
    default: return '';
  }
}

function EditableCell({ value, confidence, fieldKey, rowIndex, onUpdate, jmbgValid }) {
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
  const jmbgInvalid = fieldKey === 'jmbg' && jmbgValid === false;

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
          {(isLow || isMedium) && (
            <AlertTriangle
              size={12}
              className={`cell-warning-icon ${isLow ? 'cell-warning-icon--low' : 'cell-warning-icon--medium'}`}
            />
          )}
          <span className={isEmpty ? 'cell-empty-value' : ''}>
            {isEmpty ? '\u2014' : value}
          </span>
          {jmbgInvalid && (
            <span className="cell-jmbg-warning">
              <AlertTriangle size={11} />
              Neispravan JMBG
            </span>
          )}
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

  return (
    <div className="results-table-wrapper">
      <table className="results-table">
        <thead>
          <tr>
            <th className="col-num">#</th>
            <th className="col-doc">Dokument</th>
            <th>Broj predmeta</th>
            <th>Ime stranke</th>
            <th>JMBG</th>
            <th>Ime klijenta</th>
            <th>Iznos</th>
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
                  <td colSpan={6} className="results-error-cell">
                    <span className="results-error-message">
                      {result.error}
                    </span>
                    <button
                      className="results-retry-link"
                      onClick={(e) => { e.stopPropagation(); onRetryRow(idx); }}
                      type="button"
                    >
                      Pokusaj ponovo
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
                  <td colSpan={6}>
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
                      fieldKey={fieldKey}
                      rowIndex={idx}
                      onUpdate={onUpdateField}
                      jmbgValid={fieldKey === 'jmbg' ? field?.valid : undefined}
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

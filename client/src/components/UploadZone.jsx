import { useRef, useState, useCallback, useEffect } from 'react';
import { Upload } from 'lucide-react';
import FileList from './FileList.jsx';

const ACCEPTED_TYPE = '.pdf';

export default function UploadZone({
  files,
  onFilesSelected,
  onRemoveFile,
  onStartExtraction,
  loading,
  collapsed,
  onReset,
  maxFileSize,
}) {
  const inputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState(null);

  // Cleanup toast timer on unmount
  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  const showToast = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const validateAndAdd = useCallback((fileList) => {
    const valid = [];
    for (const file of fileList) {
      if (!file.name.toLowerCase().endsWith('.pdf') || file.type !== 'application/pdf') {
        showToast('Samo PDF fajlovi su podrzani');
        continue;
      }
      if (file.size > maxFileSize) {
        showToast(`Fajl "${file.name}" prevelik (maks. 20MB)`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length > 0) {
      onFilesSelected(valid);
    }
  }, [onFilesSelected, maxFileSize, showToast]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    validateAndAdd(droppedFiles);
  }, [validateAndAdd]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    // Only reset if cursor actually left the drop zone (not entering a child element)
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback((e) => {
    const selected = Array.from(e.target.files);
    validateAndAdd(selected);
    e.target.value = '';
  }, [validateAndAdd]);

  const handleBrowseClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  // Collapsed strip after results
  if (collapsed) {
    return (
      <div className="upload-collapsed">
        <span className="upload-collapsed-text">
          {files.length} dokument(a) obradjen(o)
        </span>
        <button className="upload-collapsed-link" onClick={onReset}>
          + Dodaj nove
        </button>
      </div>
    );
  }

  return (
    <div
      className={`upload-zone ${dragOver ? 'upload-zone--drag' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPE}
        multiple
        className="upload-input-hidden"
        onChange={handleInputChange}
      />

      <div className="upload-zone-content">
        <Upload size={48} className="upload-icon" />
        <p className="upload-primary-text">Prevucite PDF dokumente ovde</p>
        <p className="upload-secondary-text">ili</p>
        <button className="upload-browse-btn" onClick={handleBrowseClick} type="button">
          Izaberite fajlove
        </button>
        <p className="upload-caption">PDF format, do 20MB po fajlu</p>
      </div>

      {files.length > 0 && (
        <>
          <div className="upload-divider" />
          <FileList files={files} onRemove={onRemoveFile} />
          {files.length > 20 && (
            <p className="upload-warning-text">
              Veliki broj fajlova — obrada moze trajati duze
            </p>
          )}
          <p className="upload-file-count">
            {files.length} dokument(a) izabran(o)
          </p>
          <button
            className="upload-start-btn"
            onClick={onStartExtraction}
            disabled={loading}
            type="button"
          >
            Pokreni ekstrakciju
          </button>
        </>
      )}

      {toast && (
        <div className="upload-toast">{toast}</div>
      )}
    </div>
  );
}

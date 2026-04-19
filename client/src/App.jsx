import { useState, useRef, useEffect, useCallback } from 'react';
import { extractDocuments, downloadExcel, submitBatch, pollBatch } from './api.js';
import { validateJmbg } from './constants.js';
import Header from './components/Header.jsx';
import UploadZone from './components/UploadZone.jsx';
import ProcessingBar from './components/ProcessingBar.jsx';
import ResultsToolbar from './components/ResultsToolbar.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import PdfPreview from './components/PdfPreview.jsx';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_RETRY_POLLS = 90; // ~3 minutes max for retry

function findFirstProblematicRow(results) {
  if (!results) return null;
  return results.findIndex(r => {
    if (r.error) return true;
    if (!r.fields) return true;
    return Object.values(r.fields).some(
      f => f.confidence === 'low' || f.confidence === 'medium' || !f.value
    );
  });
}

export default function App() {
  const [results, setResults] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const abortRef = useRef(null);
  const previewUrlRef = useRef(null);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  const selectRow = useCallback((index) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (index !== null && files[index]) {
      previewUrlRef.current = URL.createObjectURL(files[index]);
    }
    setSelectedRow(index);
  }, [files]);

  const closePreview = useCallback(() => {
    selectRow(null);
  }, [selectRow]);

  // Escape key closes preview
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape' && selectedRow !== null) {
        closePreview();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [selectedRow, closePreview]);

  const handleFilesSelected = useCallback((newFiles) => {
    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
  }, []);

  const handleRemoveFile = useCallback((index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleStartExtraction = useCallback(async () => {
    if (files.length === 0) return;

    setLoading(true);
    setError(null);
    setResults(null);
    setProgress(null);
    selectRow(null);

    abortRef.current = new AbortController();

    try {
      const extractedResults = await extractDocuments(files, {
        onProgress: (status) => {
          setProgress({ total: status.total, completed: status.completed });
        },
        signal: abortRef.current.signal,
      });

      setResults(extractedResults);
      setLoading(false);
      setProgress(null);

      // Auto-open first problematic row
      const problemIdx = findFirstProblematicRow(extractedResults);
      if (problemIdx >= 0) {
        // Need to use the files from current closure for object URL
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = URL.createObjectURL(files[problemIdx]);
        setSelectedRow(problemIdx);
      }
    } catch (err) {
      if (err.message === 'Cancelled') {
        setLoading(false);
        setProgress(null);
        return;
      }
      setError(err.response?.data?.error?.message || err.message || 'Greska prilikom obrade');
      setLoading(false);
      setProgress(null);
    }
  }, [files, selectRow]);

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  const handleUpdateField = useCallback((rowIndex, fieldName, newValue) => {
    setResults(prev => {
      if (!prev) return prev;
      const updated = [...prev];
      const fieldUpdate = {
        ...updated[rowIndex].fields[fieldName],
        value: newValue,
      };
      // Re-validate JMBG on edit
      if (fieldName === 'jmbg') {
        fieldUpdate.valid = newValue ? validateJmbg(newValue) : undefined;
      }
      updated[rowIndex] = {
        ...updated[rowIndex],
        fields: {
          ...updated[rowIndex].fields,
          [fieldName]: fieldUpdate,
        },
      };
      return updated;
    });
  }, []);

  const handleExport = useCallback(async () => {
    if (!results) return;

    // Check for error rows
    const errorCount = results.filter(r => r.error).length;
    if (errorCount > 0) {
      const proceed = window.confirm(
        `${errorCount} dokument(a) ima(ju) greške i neće biti uključen(a). Nastavi?`
      );
      if (!proceed) return;
    }

    setExporting(true);
    try {
      const successResults = results.filter(r => !r.error);
      const blob = await downloadExcel(successResults);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `LegalAI_Ekstrakcija_${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Greska prilikom preuzimanja Excel fajla');
    } finally {
      setExporting(false);
    }
  }, [results]);

  const handleRetryRow = useCallback(async (rowIndex) => {
    const file = files[rowIndex];
    if (!file) return;

    // Mark as retrying
    setResults(prev => {
      const updated = [...prev];
      updated[rowIndex] = { filename: file.name, retrying: true };
      return updated;
    });

    const markFailed = () => {
      setResults(prev => {
        if (!prev) return prev;
        const updated = [...prev];
        updated[rowIndex] = { filename: file.name, error: 'Ponovni pokušaj nije uspeo' };
        return updated;
      });
    };

    try {
      const batch = await submitBatch([file]);
      let pollCount = 0;
      const poll = async () => {
        pollCount++;
        if (pollCount > MAX_RETRY_POLLS) {
          markFailed();
          return;
        }
        try {
          const status = await pollBatch(batch.batchId);
          if (status.status === 'complete') {
            setResults(prev => {
              if (!prev) return prev;
              const updated = [...prev];
              updated[rowIndex] = status.results[0];
              return updated;
            });
            return;
          }
          setTimeout(poll, 2000);
        } catch (pollErr) {
          markFailed();
        }
      };
      poll();
    } catch (err) {
      markFailed();
    }
  }, [files]);

  const handleReset = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setResults(null);
    setFiles([]);
    setSelectedRow(null);
    setProgress(null);
    setLoading(false);
    setError(null);
  }, []);

  const hasResults = results && results.length > 0;
  const previewOpen = selectedRow !== null;

  return (
    <div className="app">
      <Header />

      <main className="main-content">
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button className="error-banner-close" onClick={() => setError(null)}>
              &times;
            </button>
          </div>
        )}

        {!loading && (
          <UploadZone
            files={files}
            onFilesSelected={handleFilesSelected}
            onRemoveFile={handleRemoveFile}
            onStartExtraction={handleStartExtraction}
            loading={loading}
            collapsed={hasResults}
            onReset={handleReset}
            maxFileSize={MAX_FILE_SIZE}
          />
        )}

        {loading && progress && (
          <ProcessingBar
            total={progress.total}
            completed={progress.completed}
            onCancel={handleCancel}
          />
        )}

        {loading && !progress && (
          <div className="spinner-area">
            <div className="spinner" />
            <p>Ekstrakcija podataka u toku...</p>
          </div>
        )}

        {hasResults && (
          <>
            <ResultsToolbar
              count={results.length}
              onExport={handleExport}
              exporting={exporting}
            />
            <ResultsTable
              results={results}
              selectedRow={selectedRow}
              onSelectRow={selectRow}
              onUpdateField={handleUpdateField}
              onRetryRow={handleRetryRow}
            />
          </>
        )}

        {previewOpen && (
          <PdfPreview
            filename={results[selectedRow]?.filename || files[selectedRow]?.name}
            pdfUrl={previewUrlRef.current}
            fields={results[selectedRow]?.fields}
            onClose={closePreview}
            onUpdateField={(fieldName, newValue) =>
              handleUpdateField(selectedRow, fieldName, newValue)
            }
          />
        )}
      </main>
    </div>
  );
}

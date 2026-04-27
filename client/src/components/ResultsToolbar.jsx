import { Download, Loader2 } from 'lucide-react';

export default function ResultsToolbar({ count, onExport, exporting }) {
  return (
    <div className="results-toolbar">
      <span className="results-toolbar-summary">
        Rezultati ekstrakcije — {count} dokument(a)
      </span>
      <button
        className="results-toolbar-export"
        onClick={onExport}
        disabled={exporting}
        type="button"
      >
        {exporting ? (
          <Loader2 size={16} className="spin" />
        ) : (
          <Download size={16} />
        )}
        <span>Preuzmi A1 Excel</span>
      </button>
    </div>
  );
}

export default function ProcessingBar({ total, completed, onCancel }) {
  const percent = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className="processing-bar">
      <div className="processing-bar-top">
        <span className="processing-bar-text">
          Obrada u toku... {completed} od {total} dokumenata
        </span>
        <button className="processing-bar-cancel" onClick={onCancel} type="button">
          Otkaži
        </button>
      </div>
      <div className="processing-bar-track">
        <div
          className="processing-bar-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

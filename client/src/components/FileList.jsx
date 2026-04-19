import FileListItem from './FileListItem.jsx';

export default function FileList({ files, onRemove, statuses }) {
  return (
    <div className="file-list">
      {files.map((file, index) => (
        <FileListItem
          key={`${file.name}-${index}`}
          file={file}
          index={index}
          onRemove={onRemove}
          status={statuses?.[index]}
        />
      ))}
    </div>
  );
}

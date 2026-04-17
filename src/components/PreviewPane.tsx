import { PreviewPaneReadonly } from './PreviewPaneReadonly';
import { PreviewEditor } from './PreviewEditor';
import type { MarkdownFileEntry } from '../types';

type Props = {
  content: string;
  files: MarkdownFileEntry[];
  activeFilePath: string;
  rootFolder: string | null;
  onNavigate: (absolutePath: string) => void;
  onCreateFile?: (name: string) => void;
  onToggleCheckbox?: (index: number) => void;
  editable?: boolean;
  onChange?: (nextContent: string) => void;
};

export function PreviewPane(props: Props) {
  const { editable, onChange, onToggleCheckbox, ...rest } = props;

  if (editable && onChange) {
    return (
      <PreviewEditor
        content={rest.content}
        files={rest.files}
        activeFilePath={rest.activeFilePath}
        rootFolder={rest.rootFolder}
        onNavigate={rest.onNavigate}
        onCreateFile={rest.onCreateFile}
        onChange={onChange}
      />
    );
  }

  return <PreviewPaneReadonly {...rest} onToggleCheckbox={onToggleCheckbox} />;
}

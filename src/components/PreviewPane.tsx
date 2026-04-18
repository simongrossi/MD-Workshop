import { Suspense, lazy } from 'react';
import { PreviewPaneReadonly } from './PreviewPaneReadonly';
import type { MarkdownFileEntry } from '../types';

// TipTap + all its extensions are only needed in WYSIWYG mode; defer loading
// them until the user actually flips editable on.
const PreviewEditor = lazy(() =>
  import('./PreviewEditor').then((m) => ({ default: m.PreviewEditor }))
);

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
      <Suspense fallback={<section className="preview-pane" aria-busy="true" />}>
        <PreviewEditor
          content={rest.content}
          files={rest.files}
          activeFilePath={rest.activeFilePath}
          rootFolder={rest.rootFolder}
          onNavigate={rest.onNavigate}
          onCreateFile={rest.onCreateFile}
          onChange={onChange}
        />
      </Suspense>
    );
  }

  return <PreviewPaneReadonly {...rest} onToggleCheckbox={onToggleCheckbox} />;
}

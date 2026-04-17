import type { SearchResult } from '../types';

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  results: SearchResult[];
  onOpenResult: (path: string) => void;
  loading: boolean;
};

export function SearchPanel({ query, onQueryChange, onSearch, results, onOpenResult, loading }: Props) {
  return (
    <section className="sidebar-section sidebar-search">
      <div className="sidebar-section-header">
        <h3>Recherche</h3>
      </div>
      <div className="search-bar">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onSearch();
            }
          }}
          placeholder="Recherche plein texte"
          className="text-input"
        />
        <button className="toolbar-button accent" onClick={onSearch} disabled={!query.trim() || loading}>
          {loading ? 'Recherche…' : 'Chercher'}
        </button>
      </div>
      <div className="search-results">
        {!query.trim() ? (
          <p className="sidebar-empty">Recherche dans tous les fichiers du dossier ouvert.</p>
        ) : results.length === 0 && !loading ? (
          <p className="sidebar-empty">Aucun résultat pour cette recherche.</p>
        ) : (
          results.map((result) => (
            <div key={result.path} className="search-result">
              <button className="link-button" onClick={() => onOpenResult(result.path)}>
                {result.relative_path}
              </button>
              <ul>
                {result.matches.map((match, index) => (
                  <li key={`${result.path}-${match.line_number}-${index}`}>
                    <span className="line-number">L{match.line_number}</span>
                    <span>{match.line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { searchUsers } from '../../api/users';
import { getErrorMessage } from '../../utils/errors';
import ConversationListItem from './ConversationListItem';

// The "start a new conversation" search box lives here rather than as its
// own component — it's a small, single-purpose piece of UI tightly coupled
// to this list (picking a result both starts/finds a conversation and
// selects it), not a general-purpose search control worth splitting out.
export default function ConversationList({
  conversations,
  selectedConversationId,
  onSelect,
  onStartConversation,
  isLoading,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearchError('');
      setIsSearching(false);
      return undefined;
    }

    setIsSearching(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const users = await searchUsers(query);
        setResults(users);
        setSearchError('');
      } catch (err) {
        setSearchError(getErrorMessage(err, 'Could not search users'));
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  function handlePick(user) {
    setQuery('');
    setResults([]);
    onStartConversation(user.id);
  }

  const showResultsPanel = query.trim().length > 0;

  return (
    <aside className="conversation-list">
      <div className="conversation-list-header">
        <h2>Chats</h2>
      </div>

      <div className="user-search">
        <input
          type="text"
          placeholder="Find someone by username…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {showResultsPanel && (
          <div className="user-search-results">
            {isSearching && <div className="user-search-empty">Searching…</div>}

            {!isSearching && searchError && (
              <div className="user-search-empty">{searchError}</div>
            )}

            {!isSearching && !searchError && results.length === 0 && (
              <div className="user-search-empty">No users found</div>
            )}

            {!isSearching &&
              !searchError &&
              results.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="user-search-result"
                  onClick={() => handlePick(user)}
                >
                  {user.username}
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="conversation-list-items">
        {isLoading && (
          <div className="conversation-list-skeletons">
            <div className="skeleton conversation-skeleton" />
            <div className="skeleton conversation-skeleton" />
            <div className="skeleton conversation-skeleton" />
          </div>
        )}

        {!isLoading && conversations.length === 0 && (
          <div className="conversation-list-empty">
            <p>No conversations yet.</p>
            <p className="conversation-list-empty-sub">
              Search for someone above to start whispering.
            </p>
          </div>
        )}

        {!isLoading &&
          conversations.map((conv) => (
            <ConversationListItem
              key={conv.conversationId}
              conversation={conv}
              isActive={conv.conversationId === selectedConversationId}
              onClick={() => onSelect(conv.conversationId)}
            />
          ))}
      </div>
    </aside>
  );
}

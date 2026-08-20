import { useState, useCallback } from 'react';
import { Lock, Loader2 } from 'lucide-react';
import { verifyToken, setToken } from '../api.js';

export default function TokenGate() {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const token = value.trim();
    if (!token || checking) return;

    setChecking(true);
    setError(null);
    try {
      const valid = await verifyToken(token);
      if (valid) {
        setToken(token); // App listens via onAuthChange and unmounts the gate
      } else {
        setError('Neispravan token. Pokušajte ponovo.');
      }
    } catch {
      setError('Server nije dostupan. Pokušajte ponovo kasnije.');
    } finally {
      setChecking(false);
    }
  }, [value, checking]);

  return (
    <div className="token-gate">
      <form className="token-gate-card" onSubmit={handleSubmit}>
        <Lock size={28} className="token-gate-icon" />
        <h2 className="token-gate-title">Pristup aplikaciji</h2>
        <p className="token-gate-text">
          Unesite pristupni token da biste nastavili.
        </p>
        <input
          className="token-gate-input"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Pristupni token"
          aria-label="Pristupni token"
          autoComplete="current-password"
          autoFocus
        />
        {error && <p className="token-gate-error">{error}</p>}
        <button
          className="token-gate-btn"
          type="submit"
          disabled={checking || !value.trim()}
        >
          {checking && <Loader2 size={16} className="spin" />}
          <span>Potvrdi</span>
        </button>
      </form>
    </div>
  );
}

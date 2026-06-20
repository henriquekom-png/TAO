import React, { useState } from 'react';
import { api } from '../../api/client';
import { Lock, ArrowRight, Loader2 } from 'lucide-react';

interface LoginGateProps {
  onSuccess: () => void;
}

export function LoginGate({ onSuccess }: LoginGateProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await api.post('/auth/verify', { password });
      if (response.data.valid) {
        onSuccess();
      } else {
        setError('Senha incorreta. Tente novamente.');
      }
    } catch (err) {
      console.error(err);
      setError('Erro ao comunicar com o servidor. Verifique se o backend está rodando.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-zinc-200 overflow-hidden">
        <div className="p-8">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-6 overflow-hidden">
            <img src="/tao.png" alt="TAO App" className="w-full h-full object-contain" />
          </div>
          
          <h1 className="text-2xl font-bold text-center text-zinc-900 mb-2">
            Acesso Restrito
          </h1>
          <p className="text-center text-zinc-500 mb-8">
            Digite a senha para acessar o TAO App.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha..."
                className="w-full px-4 py-3 rounded-xl border border-zinc-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-200 transition-all outline-none"
                autoFocus
                disabled={loading}
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="w-full bg-violet-600 hover:bg-violet-700 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <>
                  Entrar <ArrowRight size={20} />
                </>
              )}
            </button>
          </form>
        </div>
        <div className="bg-zinc-50 px-8 py-4 border-t border-zinc-100 text-center">
          <p className="text-xs text-zinc-400">Ambiente de Estudos TAO</p>
        </div>
      </div>
    </div>
  );
}

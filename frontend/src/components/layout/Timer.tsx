import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Square } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Timer() {
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = window.setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    } else if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning]);

  const toggleTimer = () => setIsRunning(!isRunning);

  const stopTimer = () => {
    setIsRunning(false);
    setSeconds(0);
  };

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="px-4 py-2 border-b border-border bg-zinc-100 dark:bg-zinc-800/50 flex items-center justify-between shrink-0 text-zinc-700 dark:text-zinc-300 transition-colors">
      <div className={cn("font-mono text-lg font-semibold", isRunning ? "text-violet-600 dark:text-violet-400" : "text-zinc-600 dark:text-zinc-400")}>
        {formatTime(seconds)}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={toggleTimer}
          className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
          title={isRunning ? 'Pausar' : 'Iniciar'}
        >
          {isRunning ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          onClick={stopTimer}
          className="p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
          title="Parar"
        >
          <Square size={16} className="fill-current" />
        </button>
      </div>
    </div>
  );
}

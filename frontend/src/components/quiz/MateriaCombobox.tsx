/**
 * MateriaCombobox.tsx
 * ===================
 * A reusable combobox (input + dropdown) for the "Matéria" field.
 *
 * Behaviour:
 *  - Fetches distinct materia values from GET /questoes/materias via useMaterias().
 *  - Clicking the field opens a dropdown with the full list.
 *  - Typing filters the list in real-time (case-insensitive).
 *  - Selecting an option sets the value; the user can also type anything freely.
 *  - If the list is empty (no questions yet), the field acts as a plain input.
 *  - Clicking outside closes the dropdown.
 *
 * Props:
 *  value       — current string value (controlled)
 *  onChange    — called with the new string on every change
 *  placeholder — optional placeholder text (default varies by context)
 *  className   — optional extra classes applied to the <input>
 *  id          — optional id for the <input> (for label association)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMaterias } from '../../hooks/useQuestoes';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MateriaComboboxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  /** If true, show "(todas as matérias)" as an extra empty option at the top */
  allowEmpty?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MateriaCombobox: React.FC<MateriaComboboxProps> = ({
  value,
  onChange,
  placeholder = 'Digite ou selecione uma matéria…',
  className,
  id,
  allowEmpty = false,
}) => {
  const { data: materias = [] } = useMaterias();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep query in sync when value changes externally
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filtered list
  const filtered = materias.filter((m) =>
    m.toLowerCase().includes(query.trim().toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    onChange(v);
    setIsOpen(true);
  };

  const handleSelect = useCallback(
    (materia: string) => {
      setQuery(materia);
      onChange(materia);
      setIsOpen(false);
      inputRef.current?.focus();
    },
    [onChange]
  );

  const handleClearAndSelectAll = useCallback(() => {
    setQuery('');
    onChange('');
    setIsOpen(false);
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setIsOpen(false);
    if (e.key === 'Enter' && filtered.length === 1) {
      handleSelect(filtered[0]);
    }
  };

  const showDropdown = isOpen;

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Input */}
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          className={cn(
            'w-full pr-8', // leave room for the chevron icon
            className
          )}
        />
        {/* Chevron toggle */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Abrir lista de matérias"
          onClick={() => {
            setIsOpen((o) => !o);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
        >
          <ChevronDown
            size={15}
            className={cn('transition-transform duration-150', isOpen && 'rotate-180')}
          />
        </button>
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-lg overflow-hidden">
          {/* Scrollable list */}
          <ul
            role="listbox"
            className="max-h-52 overflow-y-auto py-1"
            aria-label="Matérias cadastradas"
          >
            {/* "(todas as matérias)" option */}
            {allowEmpty && (
              <li
                role="option"
                aria-selected={value === ''}
                onClick={handleClearAndSelectAll}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none transition-colors',
                  value === ''
                    ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 italic'
                )}
              >
                Todas as matérias
              </li>
            )}

            {filtered.length === 0 && (
              <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-400 dark:text-zinc-500 select-none">
                <Search size={13} />
                Nenhuma matéria encontrada
              </li>
            )}

            {filtered.map((materia) => (
              <li
                key={materia}
                role="option"
                aria-selected={value === materia}
                onClick={() => handleSelect(materia)}
                className={cn(
                  'px-3 py-2 text-sm cursor-pointer select-none transition-colors',
                  value === materia
                    ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                )}
              >
                {materia}
              </li>
            ))}
          </ul>

          {/* Footer hint */}
          <div className="border-t border-zinc-100 dark:border-zinc-800 px-3 py-2">
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {materias.length > 0
                ? 'Selecione uma matéria ou continue digitando para criar uma nova'
                : 'Nenhuma matéria cadastrada — digite para criar'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MateriaCombobox;

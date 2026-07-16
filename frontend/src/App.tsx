import { useState, useCallback, useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Sidebar } from './components/layout/Sidebar';
import { DocumentViewer } from './components/document/DocumentViewer';
import { AnnotationPanel } from './components/document/AnnotationPanel';
import { GlobalSearch } from './components/layout/GlobalSearch';
import { LoginGate } from './components/layout/LoginGate';

import { QuizSessionModal } from './components/quiz/QuizSessionModal';
import { QuestoesHub } from './components/quiz/QuestoesHub';
import { PanelLeft, ClipboardList, Sun, Moon, MoreVertical } from 'lucide-react';
import { PortalNavigationTarget } from './hooks/usePortals';
import { cn } from './lib/utils';
import type { Questao } from './types';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('tao_auth') === 'true');
  const [isDarkMode, setIsDarkMode] = useState(() => sessionStorage.getItem('theme') === 'dark');
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>(() => (localStorage.getItem('fontSize') as 'sm' | 'md' | 'lg') || 'sm');

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      sessionStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      sessionStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    document.documentElement.classList.remove('font-sm', 'font-md', 'font-lg');
    document.documentElement.classList.add(`font-${fontSize}`);
    localStorage.setItem('fontSize', fontSize);
  }, [fontSize]);

  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [selectedBlocoId, setSelectedBlocoId] = useState<number | null>(null);

  const [activeMobileView, setActiveMobileView] = useState<'menu' | 'document' | 'notes' | 'search' | 'simulation'>('menu');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [isQuizSessionOpen, setIsQuizSessionOpen] = useState(false);
  const [isHubActive, setIsHubActive] = useState(false);
  const [expandPastaIds, setExpandPastaIds] = useState<number[]>([]);
  const [scrollToBlocoId, setScrollToBlocoId] = useState<number | null>(null);
  const [preloadedQuestions, setPreloadedQuestions] = useState<Questao[] | undefined>(undefined);
  const [hubEditingQuestao, setHubEditingQuestao] = useState<Questao | null>(null);

  const handleGenerateSimulado = useCallback((questions: Questao[]) => {
    setPreloadedQuestions(questions);
    setIsQuizSessionOpen(true);
    setActiveMobileView('simulation');
  }, []);

  // Selecting a document exits hub mode
  const handleSelectDoc = useCallback((id: number) => {
    setSelectedDocId(id);
    setIsHubActive(false);
    setActiveMobileView('document');
  }, []);

  // Toggle states for Sidebar
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleGoToSource = useCallback((target: PortalNavigationTarget) => {
    setExpandPastaIds(target.pastaPath);
    setSelectedDocId(target.docId);
    setSelectedBlocoId(target.blocoId);
    setScrollToBlocoId(target.blocoId);
    setIsHubActive(false);
    setActiveMobileView('document');
  }, []);

  const documentContent = isHubActive ? (
    <QuestoesHub 
      initialEditQuestao={hubEditingQuestao}
      onClearInitialEditQuestao={() => setHubEditingQuestao(null)}
    />
  ) : (
    <div className="h-full overflow-y-auto bg-zinc-50/50 dark:bg-zinc-950 transition-colors">
      <DocumentViewer
        documentId={selectedDocId}
        selectedBlocoId={selectedBlocoId}
        scrollToBlocoId={scrollToBlocoId}
        onScrollComplete={() => setScrollToBlocoId(null)}
        onSelectBloco={setSelectedBlocoId}
        onGenerateSimulado={handleGenerateSimulado}
        onOpenNotes={() => setActiveMobileView('notes')}
        onBackToMenu={() => setActiveMobileView('menu')}
      />
    </div>
  );

  if (!isAuthenticated) {
    return (
      <LoginGate
        onSuccess={() => {
          localStorage.setItem('tao_auth', 'true');
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen bg-zinc-50 dark:bg-background overflow-hidden font-sans text-zinc-900 dark:text-foreground flex flex-col transition-colors">
      <Group orientation="horizontal" id="main-layout" className="relative w-full h-full overflow-hidden">
        {/* Sidebar Panel */}
        {isSidebarOpen && (
          <Panel
            id="sidebar-panel"
            defaultSize="18%"
            minSize="12%"
            maxSize="25%"
            className={cn(
              "relative z-20 flex flex-col min-h-0 bg-background transition duration-300 ease-in-out",
              "max-md:absolute max-md:inset-0 max-md:!w-full max-md:!h-full",
              activeMobileView === 'menu' 
                ? "max-md:translate-x-0 max-md:pointer-events-auto max-md:opacity-100" 
                : "max-md:-translate-x-full max-md:pointer-events-none max-md:opacity-0"
            )}
          >
            <Sidebar
              onSelectDoc={handleSelectDoc}
              selectedDocId={selectedDocId}
              expandPastaIds={expandPastaIds}
              onSelectHub={() => setIsHubActive(true)}
              isHubActive={isHubActive}
            />
          </Panel>
        )}
        {isSidebarOpen && (
          <Separator className="hidden md:flex w-2.5 items-center justify-center group cursor-col-resize select-none h-full z-20 bg-transparent relative pointer-events-none md:pointer-events-auto">
            <div className="absolute inset-y-0 w-px bg-border group-hover:bg-primary group-active:bg-primary transition-colors duration-200" />
          </Separator>
        )}

        {/* Central Workspace Panel */}
        <Panel 
          id="workspace-panel" 
          className={cn(
            "relative z-10 min-w-0 bg-white dark:bg-card flex flex-col transition duration-300 ease-in-out",
            "max-md:absolute max-md:inset-0 max-md:!w-full max-md:!h-full",
            (activeMobileView === 'document' || activeMobileView === 'notes' || activeMobileView === 'search' || activeMobileView === 'simulation')
              ? "max-md:translate-x-0 max-md:pointer-events-auto max-md:opacity-100"
              : "max-md:translate-x-full max-md:pointer-events-none max-md:opacity-0"
          )}
        >
          <header className="h-14 bg-background border-b border-border flex items-center justify-between px-6 shrink-0 shadow-soft-sm z-10 relative select-none transition-colors">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-1.5 hover:bg-slate-100 rounded-md text-slate-500 hover:text-slate-800 transition-colors"
                title={isSidebarOpen ? "Recolher barra lateral" : "Expandir barra lateral"}
              >
                <PanelLeft size={18} className={isSidebarOpen ? "" : "rotate-180"} />
              </button>
            </div>

            <GlobalSearch onSelectResult={handleGoToSource} />

            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-3">
                <div className="flex items-center bg-slate-200 dark:bg-zinc-800 rounded-full p-0.5 shadow-inner mr-1">
                  <button
                    onClick={() => setFontSize('sm')}
                    className={cn(
                      "px-2.5 py-1 text-xs font-semibold rounded-full transition-colors",
                      fontSize === 'sm' ? "bg-white dark:bg-zinc-600 text-slate-800 dark:text-zinc-100 shadow-sm" : "text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-300"
                    )}
                    title="Tamanho Padrão"
                  >
                    A-
                  </button>
                  <button
                    onClick={() => setFontSize('md')}
                    className={cn(
                      "px-2.5 py-1 text-xs font-semibold rounded-full transition-colors",
                      fontSize === 'md' ? "bg-white dark:bg-zinc-600 text-slate-800 dark:text-zinc-100 shadow-sm" : "text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-300"
                    )}
                    title="Tamanho Médio"
                  >
                    A
                  </button>
                  <button
                    onClick={() => setFontSize('lg')}
                    className={cn(
                      "px-2.5 py-1 text-xs font-semibold rounded-full transition-colors",
                      fontSize === 'lg' ? "bg-white dark:bg-zinc-600 text-slate-800 dark:text-zinc-100 shadow-sm" : "text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-300"
                    )}
                    title="Tamanho Grande"
                  >
                    A+
                  </button>
                </div>

                <button
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className="relative inline-flex items-center h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-opacity-75 bg-slate-300 dark:bg-zinc-700 shadow-inner"
                  title={isDarkMode ? "Mudar para Modo Claro" : "Mudar para Modo Escuro"}
                >
                  <span className="sr-only">Toggle Theme</span>
                  <span
                    className={cn(
                      "pointer-events-none flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                      isDarkMode ? "translate-x-5" : "translate-x-0"
                    )}
                  >
                    {isDarkMode ? (
                      <Moon size={12} className="text-zinc-700" />
                    ) : (
                      <Sun size={12} className="text-amber-500" />
                    )}
                  </span>
                </button>
                <button
                  id="quiz-session-open-btn"
                  onClick={() => setIsQuizSessionOpen(true)}
                  className="flex items-center gap-2 bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-full text-sm font-semibold hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors border border-slate-200 dark:border-zinc-700"
                >
                  <ClipboardList size={16} />
                  Simulado
                </button>
              </div>

              {/* Mobile Actions Menu */}
              <div className="md:hidden relative">
                <button
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-300 transition-colors"
                >
                  <MoreVertical size={20} />
                </button>

                {isMobileMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsMobileMenuOpen(false)}></div>
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-zinc-800 border border-border rounded-md shadow-lg z-50 p-3 flex flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">Fonte</span>
                        <div className="flex items-center justify-between bg-slate-100 dark:bg-zinc-900 rounded-md p-1">
                          <button onClick={() => { setFontSize('sm'); setIsMobileMenuOpen(false); }} className={cn("px-3 py-1.5 text-xs font-semibold rounded-md", fontSize === 'sm' ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-slate-600 dark:text-slate-400")}>A-</button>
                          <button onClick={() => { setFontSize('md'); setIsMobileMenuOpen(false); }} className={cn("px-3 py-1.5 text-xs font-semibold rounded-md", fontSize === 'md' ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-slate-600 dark:text-slate-400")}>A</button>
                          <button onClick={() => { setFontSize('lg'); setIsMobileMenuOpen(false); }} className={cn("px-3 py-1.5 text-xs font-semibold rounded-md", fontSize === 'lg' ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-slate-600 dark:text-slate-400")}>A+</button>
                        </div>
                      </div>
                      
                      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">Geral</span>
                        <button onClick={() => { setIsDarkMode(!isDarkMode); setIsMobileMenuOpen(false); }} className="flex items-center justify-between text-sm px-1 py-1 font-medium text-slate-700 dark:text-slate-300">
                          Modo Escuro
                          <div className="relative inline-flex items-center h-[20px] w-[36px] shrink-0 cursor-pointer rounded-full bg-slate-300 dark:bg-zinc-600">
                             <span className={cn("inline-block h-3 w-3 transform rounded-full bg-white transition", isDarkMode ? "translate-x-5" : "translate-x-1")} />
                          </div>
                        </button>

                        <button onClick={() => { setIsQuizSessionOpen(true); setIsMobileMenuOpen(false); }} className="flex items-center gap-2 bg-primary text-primary-foreground mt-2 px-3 py-2 rounded-md text-sm font-semibold justify-center w-full shadow-sm">
                          <ClipboardList size={15} />
                          Abrir Simulado
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-hidden min-h-0 relative">
            <Group 
              orientation="horizontal" 
              id="content-split"
              className="relative w-full h-full overflow-hidden"
            >
              {/* Document/Blocks Column */}
              <Panel
                id="blocks-panel"
                minSize="30%"
                maxSize="70%"
                defaultSize={selectedBlocoId ? "58%" : "100%"}
                className={cn(
                  "relative z-20 flex flex-col min-h-0 bg-background transition duration-300 ease-in-out",
                  "max-md:absolute max-md:inset-0 max-md:!w-full max-md:!h-full",
                  (activeMobileView === 'document' || activeMobileView === 'search' || activeMobileView === 'simulation')
                    ? "max-md:translate-x-0 max-md:pointer-events-auto max-md:opacity-100"
                    : "max-md:-translate-x-full max-md:pointer-events-none max-md:opacity-0"
                )}
              >
                {documentContent}
              </Panel>

              {selectedBlocoId && (
                <Separator className="hidden md:flex w-2.5 items-center justify-center group cursor-col-resize select-none h-full z-20 bg-transparent relative pointer-events-none md:pointer-events-auto">
                  <div className="absolute inset-y-0 w-px bg-border group-hover:bg-primary group-active:bg-primary transition-colors duration-200" />
                </Separator>
              )}

              {/* Annotation Panel */}
              {selectedBlocoId && (
                <Panel
                  id="annotation-panel"
                  minSize="25%"
                  maxSize="60%"
                  defaultSize="42%"
                  className={cn(
                    "relative z-30 flex flex-col min-h-0 bg-background border-none transition duration-300 ease-in-out",
                    "max-md:absolute max-md:inset-0 max-md:!w-full max-md:!h-full max-md:border-l max-md:border-border",
                    activeMobileView === 'notes'
                      ? "max-md:translate-x-0 max-md:pointer-events-auto max-md:opacity-100"
                      : "max-md:translate-x-full max-md:pointer-events-none max-md:opacity-0"
                  )}
                >
                  <AnnotationPanel
                    blocoId={selectedBlocoId}
                    onClose={() => {
                      setSelectedBlocoId(null);
                      setActiveMobileView('document');
                    }}
                    onGoToSource={handleGoToSource}
                    onBackToDocument={() => setActiveMobileView('document')}
                  />
                </Panel>
              )}
            </Group>
          </div>
        </Panel>
      </Group>



      {isQuizSessionOpen && (
        <QuizSessionModal
          preloadedQuestions={preloadedQuestions}
          onClose={() => {
            setIsQuizSessionOpen(false);
            setPreloadedQuestions(undefined);
          }}
          onGoToSource={(blocoId) => {
            setIsQuizSessionOpen(false);
            setPreloadedQuestions(undefined);
            setSelectedBlocoId(blocoId);
            setScrollToBlocoId(blocoId);
          }}
        />
      )}
    </div>
  );
}

export default App;
